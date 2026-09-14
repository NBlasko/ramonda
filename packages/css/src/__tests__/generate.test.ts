import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { writeGenerated } from "../generate";

/**
 * Codegen actually running, which is what turns every other piece of this feature into something a
 * project can use.
 *
 * The asymmetry: a run that writes nothing is silent, and the project then has no `$` to import — so
 * every case asserting that a file WAS written is load-bearing, while the refusals are the cheap
 * half.
 */

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "ramonda-codegen-"));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

const CONFIG = `import { kind } from "@ramonda/css/config";

export default {
  variables: {
    color: kind("color", { primary: { main: "#3b82f6" } }),
    size: kind("length", { control: { md: "30px" } }),
  },
};
`;

const write = (name: string, text: string) => writeFileSync(join(project, name), text);

describe("running codegen", () => {
  test("writes both files beside the config", () => {
    write("ramonda.css.ts", CONFIG);
    const result = writeGenerated(project, ts);

    expect(result.files.map((one) => one.path)).toEqual([
      join(project, "ramonda.css.generated.css"),
      join(project, "ramonda.css.generated.ts"),
    ]);
    expect(readFileSync(join(project, "ramonda.css.generated.css"), "utf8")).toContain(
      "--color-primary-main: #3b82f6;",
    );
    expect(readFileSync(join(project, "ramonda.css.generated.ts"), "utf8")).toContain("--color-primary-main");
  });

  test("every declared variable is registered, which is what makes a bare `var()` safe", () => {
    write("ramonda.css.ts", CONFIG);
    writeGenerated(project, ts);

    expect(readFileSync(join(project, "ramonda.css.generated.css"), "utf8").match(/@property/g)).toHaveLength(2);
  });

  /**
   * **The trap a bundler plugin brings with it.** The plugin runs codegen, codegen writes a file the
   * bundler is watching, the write is a change, the change is a rebuild — and the plugin runs again.
   * Writing only when the CONTENT differs is what ends that, so it is asserted rather than assumed.
   */
  test("a second run with nothing changed writes nothing at all", () => {
    write("ramonda.css.ts", CONFIG);
    writeGenerated(project, ts);
    const stamped = statSync(join(project, "ramonda.css.generated.ts")).mtimeMs;

    const again = writeGenerated(project, ts);

    expect(again.files.every((one) => !one.changed)).toBe(true);
    expect(statSync(join(project, "ramonda.css.generated.ts")).mtimeMs).toBe(stamped);
  });

  test("a changed config is written through", () => {
    write("ramonda.css.ts", CONFIG);
    writeGenerated(project, ts);

    write("ramonda.css.ts", CONFIG.replace("#3b82f6", "#10b981"));
    const again = writeGenerated(project, ts);

    expect(again.files.some((one) => one.changed)).toBe(true);
    expect(readFileSync(join(project, "ramonda.css.generated.css"), "utf8")).toContain("#10b981");
  });

  test("no config is no files, and it says which it was", () => {
    const result = writeGenerated(project, ts);

    expect(result.config).toBeUndefined();
    expect(result.files).toEqual([]);
  });

  test("a config that declares no variables writes nothing rather than two empty files", () => {
    write("ramonda.css.ts", `export default { units: ["px"] };\n`);
    const result = writeGenerated(project, ts);

    expect(result.config).toBeDefined();
    expect(result.declared).toBe(0);
    expect(result.files).toEqual([]);
  });

  test("two paths spelling one custom property stop the run", () => {
    write(
      "ramonda.css.ts",
      `import { kind } from "@ramonda/css/config";
export default { variables: { "a-b": kind("length", { c: "1px" }), a: kind("length", { "b-c": "2px" }) } };
`,
    );

    expect(() => writeGenerated(project, ts)).toThrow(/--a-b-c/);
  });
});
