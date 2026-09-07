import { describe, expect, test } from "vitest";
import ts from "typescript";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../config";
import { findConfig, readConfig } from "../config";
import { readBlock } from "../compiler/read";
import { checkBlock } from "../compiler/rules";

/**
 * The project's own settings, read from a `ramonda.css.ts`.
 *
 * ## Why a file at all, when the plugin already takes options
 *
 * `vite.config.ts` receives the mode, in TypeScript, for free — a project that wants hashed names in
 * production writes it there and needs nothing else. What plugin options cannot reach is
 * `ramonda-css lint`, `ramonda-css format`, and the editor: none of them reads a bundler's config.
 * So the file holds what those three must agree about, and the build keeps its own options.
 *
 * ## Why it is TypeScript rather than JSON, and how that is affordable
 *
 * The user asked for it and gave the reason: a setting may depend on the environment. A config that
 * is a FUNCTION of the environment cannot be JSON.
 *
 * Loading a `.ts` file inside `tsserver` — CommonJS, no `ts-node` — looked like the blocker. It is
 * not: **tsserver hands the plugin the `typescript` object**, so the plugin transpiles the config
 * itself, on whatever Node the editor happens to run. Measured against the two alternatives, both of
 * which work on Node 24 and tie the config to a Node version the editor picked rather than the
 * project: `require(".ts")` (type stripping) and `import(".ts")`.
 */
describe("the project's config", () => {
  const project = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "ramonda-config-"));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return dir;
  };

  test("a plain object", () => {
    const dir = project({ "ramonda.css.ts": `export default { units: ["px", "rem"] };\n` });

    expect(readConfig(findConfig(dir), ts)).toEqual({ units: ["px", "rem"] });
  });

  test("a function of the environment, which is why it is not JSON", () => {
    const dir = project({
      "ramonda.css.ts": `export default (env: { production: boolean }) => ({\n  units: env.production ? ["px"] : ["px", "rem"],\n});\n`,
    });

    expect(readConfig(findConfig(dir), ts, { production: true })).toEqual({ units: ["px"] });
    expect(readConfig(findConfig(dir), ts, { production: false })).toEqual({ units: ["px", "rem"] });
  });

  test("TypeScript that is not erasable, which type stripping would refuse", () => {
    const dir = project({
      "ramonda.css.ts": `enum Unit { px = "px" }\nexport default { units: [Unit.px] };\n`,
    });

    expect(readConfig(findConfig(dir), ts)).toEqual({ units: ["px"] });
  });

  test("found by walking up, the way a tool run from a subdirectory needs", () => {
    const dir = project({ "ramonda.css.ts": `export default { units: ["px"] };\n` });

    expect(findConfig(join(dir, "src", "deep"))).toBe(join(dir, "ramonda.css.ts"));
  });

  describe("what it does when there is nothing to read", () => {
    test("no config at all is the empty config, not an error", () => {
      expect(findConfig(project({}))).toBeUndefined();
      expect(readConfig(undefined, ts)).toEqual({});
    });

    /**
     * A config that throws is REPORTED, not swallowed. A tool that quietly ran with default settings
     * because somebody's config had a typo would be the worst of both: the settings are not applied
     * and nothing says so.
     */
    test("one that throws says which file and why", () => {
      const dir = project({ "ramonda.css.ts": `throw new Error("nope");\n` });

      expect(() => readConfig(findConfig(dir), ts)).toThrow(/ramonda\.css\.ts/);
      expect(() => readConfig(findConfig(dir), ts)).toThrow(/nope/);
    });

    test("one that exports nothing", () => {
      const dir = project({ "ramonda.css.ts": `const unused = 1;\n` });

      expect(() => readConfig(findConfig(dir), ts)).toThrow(/default/);
    });

    test("one whose default is not an object", () => {
      const dir = project({ "ramonda.css.ts": `export default 42;\n` });

      expect(() => readConfig(findConfig(dir), ts)).toThrow(/object/);
    });
  });

  describe("what it refuses to hold", () => {
    /**
     * The `r-` prefix and anything that changes `normalise`. Both are identity: two packages emitting
     * different names for one block break deduplication with no registry to repair it, and that is
     * the property the whole design rests on. See CONTRACT.md §3.
     */
    test.each(["prefix", "hash", "normalise"])("`%s` is refused, with the reason", (key) => {
      const dir = project({ "ramonda.css.ts": `export default { ${key}: "x" };\n` });

      expect(() => readConfig(findConfig(dir), ts)).toThrow(/identity/i);
    });

    test("and an unknown key is refused too, because a typo is silent otherwise", () => {
      const dir = project({ "ramonda.css.ts": `export default { untis: ["px"] };\n` });

      expect(() => readConfig(findConfig(dir), ts)).toThrow(/untis/);
    });
  });
});

/**
 * The config reaching the rules, which is the only thing that makes it worth having.
 *
 * Two settings, and they are different in kind: `units` ADDS a report that CSS itself would not
 * make, and `rules` takes one away. Both are project decisions, and neither can change what a class
 * is called — see the identity guard above.
 */
describe("what the config does to the rules", () => {
  const of = (declaration: string, config: Config) =>
    checkBlock(readBlock(`@@(\n  ${declaration};\n)`, 2, "C.tsx").block, { config }).map((one) => one.rule);

  test("a unit the project does not allow", () => {
    expect(of("padding: 1em", { units: ["px", "rem"] })).toEqual(["unit-not-allowed"]);
  });

  test("and one it does", () => {
    expect(of("padding: 1rem", { units: ["px", "rem"] })).toEqual([]);
  });

  test("with no `units` at all, every unit CSS has is fine", () => {
    expect(of("padding: 1em", {})).toEqual([]);
  });

  /**
   * A unit that is not a unit is a typo wherever it is written, and `unknown-unit` names it. Reading
   * both on one declaration would be two faults where there is one.
   */
  test("a unit CSS does not have is left to the rule that names it", () => {
    expect(of("padding: 10pxx", { units: ["px"] })).toEqual(["unknown-unit"]);
  });

  test("the message says what the project allows", () => {
    const [only] = checkBlock(readBlock(`@@(\n  padding: 1em;\n)`, 2, "C.tsx").block, {
      config: { units: ["px", "rem"] },
    });

    expect(only.message).toContain("px, rem");
  });

  test("a rule turned off says nothing", () => {
    expect(of("padding: 10pxx", { rules: { "unknown-unit": "off" } })).toEqual([]);
  });

  test("and turning one off leaves the others alone", () => {
    const rules = of("padding-lft: 10pxx", { rules: { "unknown-unit": "off" } });

    expect(rules).not.toContain("unknown-unit");
    expect(rules).toContain("unknown-property");
  });
});
