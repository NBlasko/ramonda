import { describe, expect, test } from "vitest";
import ts from "typescript";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../config";
import { configReader, environmentOf, findConfig, readConfig } from "../config";
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

  /**
   * And the WIRING, which is a different claim from the one above and had no test at all.
   *
   * A review found `environment` never supplied: all four consumers passed two arguments, so
   * `env.production` was always `undefined` and every such config silently took its development
   * branch — in production builds included. The test above passed throughout, because it calls
   * `readConfig` itself. **One rule, four consumers, and nothing watching the join.**
   */
  test("`environmentOf` answers from NODE_ENV when nobody knows better", () => {
    const before = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(environmentOf()).toEqual({ production: true });
      process.env.NODE_ENV = "development";
      expect(environmentOf()).toEqual({ production: false });
    } finally {
      if (before === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = before;
    }
  });

  test("and a consumer that KNOWS is believed over it", () => {
    const before = process.env.NODE_ENV;
    try {
      // A bundler is told which build this is; `NODE_ENV` is the fallback, not the authority.
      process.env.NODE_ENV = "development";
      expect(environmentOf(true)).toEqual({ production: true });
      process.env.NODE_ENV = "production";
      // An editor session is a development session, whatever the shell says.
      expect(environmentOf(false)).toEqual({ production: false });
    } finally {
      if (before === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = before;
    }
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

  /**
   * Where the walk STOPS, which it did not: only at the filesystem root.
   *
   * Reading a stray file would be one thing. This one is EXECUTED — transpiled and run through
   * `new Function`, inside `tsserver`, on merely opening a folder, with nothing shown to say which
   * file was loaded. So a `ramonda.css.ts` left in a home directory from an experiment, or unzipped
   * beside a downloaded project, silently became every project's settings.
   *
   * The repository root is the outermost thing that is still "the project", so the walk checks the
   * directory holding `.git` and stops there. A project that is not a repository still stops before
   * the home directory, which is the case this exists for.
   */
  describe("how far up it looks", () => {
    test("stops at the repository root, and does not read what is above it", () => {
      const outer = project({ "ramonda.css.ts": `export default { units: ["cm"] };\n` });
      const repo = join(outer, "repo");
      mkdirSync(join(repo, ".git"), { recursive: true });
      mkdirSync(join(repo, "src"), { recursive: true });

      expect(findConfig(join(repo, "src"))).toBeUndefined();
    });

    test("but the root's OWN config is the one a monorepo shares", () => {
      const outer = project({});
      const repo = join(outer, "repo");
      mkdirSync(join(repo, ".git"), { recursive: true });
      mkdirSync(join(repo, "packages", "web"), { recursive: true });
      writeFileSync(join(repo, "ramonda.css.ts"), `export default { units: ["px"] };\n`);

      expect(findConfig(join(repo, "packages", "web"))).toBe(join(repo, "ramonda.css.ts"));
    });

    test("and a package's own config still wins over the root's", () => {
      const repo = project({ "ramonda.css.ts": `export default { units: ["px"] };\n` });
      mkdirSync(join(repo, ".git"), { recursive: true });
      const inner = join(repo, "packages", "web");
      mkdirSync(inner, { recursive: true });
      writeFileSync(join(inner, "ramonda.css.ts"), `export default { units: ["rem"] };\n`);

      expect(findConfig(inner)).toBe(join(inner, "ramonda.css.ts"));
    });

    /** A dependency's own file is not this project's settings, whatever it holds. */
    test("a config inside node_modules is not a project's settings", () => {
      const repo = project({});
      mkdirSync(join(repo, ".git"), { recursive: true });
      const dep = join(repo, "node_modules", "some-package");
      mkdirSync(dep, { recursive: true });
      writeFileSync(join(dep, "ramonda.css.ts"), `export default { units: ["cm"] };\n`);

      expect(findConfig(dep)).toBeUndefined();
    });
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

  /**
   * A key with the right NAME and the wrong VALUE, which was a cast and nothing else.
   *
   * `readConfig` validated key names and returned `config as Config`. A review traced where an
   * unchecked value lands, and it is not a diagnostic — it is a `TypeError` deep in `rules.ts`,
   * thrown from inside the editor's `getScriptSnapshot`. tsserver asks for a snapshot of every file
   * in the program, so **one wrong value in one config takes down completion, hover and every
   * squiggle in the whole project**, and does it again on every retry because the cache is written
   * after the throw. The build dies with a stack naming neither the file nor the key.
   *
   * Nothing types this file — the documented example is a bare object literal — so a wrong value is
   * not exotic. `units: "px"` is the obvious thing to write when the list has one entry.
   */
  describe("a key whose value is the wrong shape", () => {
    const refused = (body: string) => {
      const dir = project({ "ramonda.css.ts": `export default ${body};\n` });
      return () => readConfig(findConfig(dir), ts);
    };

    test.each([
      ["units as a bare string", `{ units: "px" }`, /units/],
      ["units holding a number", `{ units: [1] }`, /units/],
      ["units as null", `{ units: null }`, /units/],
      ["rules as null", `{ rules: null }`, /rules/],
      ["rules as an array", `{ rules: ["unknown-unit"] }`, /rules/],
      ["a rule set to a boolean", `{ rules: { "unknown-unit": false } }`, /unknown-unit/],
      ["a rule set to a word that is not a severity", `{ rules: { "unknown-unit": "quiet" } }`, /quiet/],
      ["variables as a bare string", `{ variables: "--brand" }`, /variables/],
      ["variables holding a number", `{ variables: [1] }`, /variables/],
      // A custom property begins with two dashes. `brand` is a property name, and a list of those
      // would silence a rule about names it was never given.
      ["a variable with no dashes", `{ variables: ["brand"] }`, /two dashes/],
    ])("%s is refused, naming what is wrong", (_what, body, says) => {
      expect(refused(body)).toThrow(says);
    });

    /** A rule id that does not exist is a typo, and a typo that is ignored is invisible. */
    test("a misspelled rule id is refused, with the nearest real one", () => {
      expect(refused(`{ rules: { "unkown-unit": "off" } }`)).toThrow(/unknown-unit/);
    });

    /**
     * `format: { indent }` was accepted, validated and documented in its own type, and NOTHING read
     * it: a person could set it, be told nothing, and get two spaces. A review found it.
     *
     * It is refused rather than wired up, because the formatter now reads the step off the file it
     * has just laid out — the project has already told biome or prettier how wide a level is, and a
     * second place to say it can only disagree with the first. The refusal says that, since
     * somebody who wrote it needs to know where the answer comes from instead.
     */
    test("`format` is refused, and the message says who decides indentation now", () => {
      expect(refused(`{ format: { indent: 4 } }`)).toThrow(/formatter/);
    });

    test.each([
      ["one unit", `{ units: ["px"] }`],
      ["a variable this compiler cannot see", `{ variables: ["--brand"] }`],
      ["several", `{ units: ["px", "rem", "%"] }`],
      ["a rule silenced", `{ rules: { "unknown-unit": "off" } }`],
      ["a rule set to error, which is the default", `{ rules: { "unknown-unit": "error" } }`],
      ["an empty object", `{}`],
    ])("%s is accepted", (_what, body) => {
      expect(refused(body)).not.toThrow();
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

/**
 * WHICH config governs a file — the question three consumers answered three different ways.
 *
 * A review found one setting read from three roots: `check.ts` walked up from the tsconfig's
 * directory, `vite.ts` and `esbuild.ts` from `process.cwd()`, and the editor from
 * `host.getCurrentDirectory()`. In a monorepo those are three different answers for one file, and
 * the one the author sees squiggled in the editor is not the one the build enforces.
 *
 * The file being compiled is the only anchor that cannot depend on where a command was typed, so it
 * is the anchor. The ninth occurrence of the repository's recurring fault: one rule, many consumers.
 *
 * The cache is keyed on the config's own TEXT rather than on a timestamp or on nothing at all.
 * That is what makes the second half of the review's finding go away by construction: a dev server
 * that read the file once at startup kept compiling yesterday's settings while the editor had
 * already moved on, and there is no hook to forget here because there is nothing stale to forget.
 */
describe("which config governs a file", () => {
  const monorepo = () => {
    const repo = mkdtempSync(join(tmpdir(), "ramonda-reader-"));
    mkdirSync(join(repo, ".git"), { recursive: true });
    for (const name of ["web", "admin"]) mkdirSync(join(repo, "packages", name), { recursive: true });
    writeFileSync(join(repo, "packages", "web", "ramonda.css.ts"), `export default { units: ["px"] };\n`);
    writeFileSync(join(repo, "packages", "admin", "ramonda.css.ts"), `export default { units: ["rem"] };\n`);
    return repo;
  };

  const inside = <T>(dir: string, run: () => T): T => {
    const before = process.cwd();
    process.chdir(dir);
    try {
      return run();
    } finally {
      process.chdir(before);
    }
  };

  test("the file's own package, not the one a command was typed in", () => {
    const repo = monorepo();
    const read = configReader(ts);

    inside(join(repo, "packages", "web"), () => {
      expect(read(join(repo, "packages", "web", "Card.tsx"))).toEqual({ units: ["px"] });
      expect(read(join(repo, "packages", "admin", "Card.tsx"))).toEqual({ units: ["rem"] });
    });
  });

  test("and the same two answers from the other package's directory", () => {
    const repo = monorepo();
    const read = configReader(ts);

    inside(join(repo, "packages", "admin"), () => {
      expect(read(join(repo, "packages", "web", "Card.tsx"))).toEqual({ units: ["px"] });
      expect(read(join(repo, "packages", "admin", "Card.tsx"))).toEqual({ units: ["rem"] });
    });
  });

  test("a file with no config above it is the empty config", () => {
    const repo = monorepo();
    mkdirSync(join(repo, "packages", "bare"), { recursive: true });

    expect(configReader(ts)(join(repo, "packages", "bare", "Card.tsx"))).toEqual({});
  });

  /**
   * The half a long-running process gets wrong: read once at startup, never again. A dev server
   * kept the settings it booted with while the author edited the file the editor was already
   * reading fresh — two tools, one file, two answers.
   */
  test("a config edited while the process runs is read again", () => {
    const repo = monorepo();
    const file = join(repo, "packages", "web", "Card.tsx");
    const read = configReader(ts);

    expect(read(file)).toEqual({ units: ["px"] });
    writeFileSync(join(repo, "packages", "web", "ramonda.css.ts"), `export default { units: ["ch"] };\n`);

    expect(read(file)).toEqual({ units: ["ch"] });
  });

  test("and a config WRITTEN while it runs is found", () => {
    const repo = monorepo();
    mkdirSync(join(repo, "packages", "late"), { recursive: true });
    const file = join(repo, "packages", "late", "Card.tsx");
    const read = configReader(ts);

    expect(read(file)).toEqual({});
    writeFileSync(join(repo, "packages", "late", "ramonda.css.ts"), `export default { units: ["vh"] };\n`);

    expect(read(file)).toEqual({ units: ["vh"] });
  });

  /**
   * Reading fresh is only affordable because what it re-reads is a file measured in tens of lines.
   * The transpile and the `new Function` are what cost, and they happen once per thing the file
   * says — not once per file compiled against it.
   */
  test("one config, transpiled once however many files ask", () => {
    const repo = monorepo();
    const counting = join(repo, "packages", "web", "ramonda.css.ts");
    writeFileSync(counting, `(globalThis as unknown as { runs: number }).runs++;\nexport default { units: ["px"] };\n`);
    (globalThis as unknown as { runs: number }).runs = 0;
    const read = configReader(ts);

    for (let i = 0; i < 50; i++) read(join(repo, "packages", "web", `Card${i}.tsx`));

    expect((globalThis as unknown as { runs: number }).runs).toBe(1);
  });

  test("and once more after it changes, not once per file after it", () => {
    const repo = monorepo();
    const counting = join(repo, "packages", "web", "ramonda.css.ts");
    const body = (unit: string) =>
      `(globalThis as unknown as { runs: number }).runs++;\nexport default { units: ["${unit}"] };\n`;
    writeFileSync(counting, body("px"));
    (globalThis as unknown as { runs: number }).runs = 0;
    const read = configReader(ts);

    for (let i = 0; i < 10; i++) read(join(repo, "packages", "web", `Card${i}.tsx`));
    writeFileSync(counting, body("ch"));
    for (let i = 0; i < 10; i++) read(join(repo, "packages", "web", `Card${i}.tsx`));

    expect((globalThis as unknown as { runs: number }).runs).toBe(2);
  });

  /**
   * The environment arrives LATER than the reader does. Vite constructs a plugin before any hook
   * runs and only tells it which build this is in `config`, so a reader that captured the answer at
   * construction would capture the one nobody had yet.
   */
  test("the environment is asked for when a config is read, not when the reader is made", () => {
    const repo = monorepo();
    writeFileSync(
      join(repo, "packages", "web", "ramonda.css.ts"),
      `export default (env: { production: boolean }) => ({ units: env.production ? ["px"] : ["px", "em"] });\n`,
    );
    let production: boolean | undefined;
    const read = configReader(ts, () => environmentOf(production));
    const file = join(repo, "packages", "web", "Card.tsx");

    production = true;
    expect(read(file)).toEqual({ units: ["px"] });
    production = false;
    expect(read(file)).toEqual({ units: ["px", "em"] });
  });

  test("a config that throws is reported, and reported again on the next file", () => {
    const repo = monorepo();
    writeFileSync(join(repo, "packages", "web", "ramonda.css.ts"), `export default { units: "px" };\n`);
    const read = configReader(ts);

    expect(() => read(join(repo, "packages", "web", "A.tsx"))).toThrow(/It takes a list/);
    expect(() => read(join(repo, "packages", "web", "B.tsx"))).toThrow(/It takes a list/);
  });
});

/**
 * What a config may WRITE in it, which is a smaller set than "TypeScript" until it is said out loud.
 *
 * The file is transpiled to CommonJS and run through `new Function`, so two ordinary things a
 * `.ts` file does were broken here and nowhere else — a review found both, and each failed as
 * *could not be read* with a message about the symptom rather than the cause.
 */
describe("what a config is allowed to use", () => {
  const project = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), "ramonda-config-uses-"));
    writeFileSync(join(dir, "ramonda.css.ts"), body);
    return dir;
  };

  /**
   * `import path from "node:path"` is how a default import is written and how every editor
   * completes it. Without `esModuleInterop` the transpiler emits `path_1.default`, which a CommonJS
   * module does not have, so the config died on `Cannot read properties of undefined`.
   */
  test("a default import of a CommonJS module", () => {
    const dir = project(
      `import path from "node:path";\nexport default { units: [path.sep === "/" ? "px" : "rem"] };\n`,
    );

    expect(readConfig(findConfig(dir), ts)).toEqual({ units: ["px"] });
  });

  test("and a named import, which always worked", () => {
    const dir = project(`import { sep } from "node:path";\nexport default { units: [sep === "/" ? "px" : "rem"] };\n`);

    expect(readConfig(findConfig(dir), ts)).toEqual({ units: ["px"] });
  });

  /**
   * `__dirname` is what a CommonJS file resolves a path with, and this one IS CommonJS by the time
   * it runs — but `new Function` supplies only what it is handed, so it was not defined at all.
   * A config that read a token list from beside itself threw `__dirname is not defined`.
   */
  test("`__dirname`, which is the config's own directory", () => {
    const dir = project(
      `export default { units: [__dirname.split("/").pop()!.startsWith("ramonda") ? "px" : "rem"] };\n`,
    );

    expect(readConfig(findConfig(dir), ts)).toEqual({ units: ["px"] });
  });

  /**
   * **AN `async` CONFIG WAS SILENTLY IGNORED**, and `async` is what somebody writes the moment the
   * config reads anything — a token list beside it, which is a shape this file's own notes mention.
   *
   * A Promise is an object, so the shape check let it through, `Object.keys` of it is empty, every
   * validation passed over nothing, and what came back was `{}`. Measured: `export default async ()
   * => ({ units: ["px"] })` gave the empty config, so the units were not enforced and nothing said
   * so — the exact failure this file exists to refuse, since "a tool that quietly ran with defaults
   * because somebody's config had a typo would be the worst of both".
   *
   * It cannot be awaited: the editor asks for a config inside `getScriptSnapshot`, which is
   * synchronous, and a reader that returned a promise there would have to be a second reader. So it
   * is refused, with the reason.
   */
  test.each([
    ["an async function", `export default async () => ({ units: ["px"] });\n`],
    ["a function returning a promise", `export default () => Promise.resolve({ units: ["px"] });\n`],
    ["a promise directly", `export default Promise.resolve({ units: ["px"] });\n`],
  ])("%s is refused rather than silently ignored", (_what, body) => {
    const dir = project(body);

    expect(() => readConfig(findConfig(dir), ts)).toThrow(/cannot be async|await/i);
  });

  test("and `__filename`, which is the config itself", () => {
    const dir = project(`export default { units: [__filename.endsWith("ramonda.css.ts") ? "px" : "rem"] };\n`);

    expect(readConfig(findConfig(dir), ts)).toEqual({ units: ["px"] });
  });
});
