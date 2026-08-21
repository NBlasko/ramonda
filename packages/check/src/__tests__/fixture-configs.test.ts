// @vitest-environment node
// Reads config files off disk and builds no program, so it needs `node:fs` and nothing else.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

/**
 * Every fixture's tsconfig, resolved the way `analyzeProject` resolves it.
 *
 * ## The fault this exists for
 *
 * A fixture is a tiny app the analyzer is pointed at, and its config is the same config every time —
 * only what it POINTS AT differs. That config was written out in full seventy-three times, so a change
 * to any option was a seventy-three-file edit. They share `tsconfig.base.json` now.
 *
 * What makes that worth a test is the failure mode: **a fixture whose config stops working does not
 * fail, it goes QUIET.** The package's own tsconfig excludes `src/__tests__/fixtures`, so nothing
 * type-checks them; the analyzer reads whatever options it is handed and reports what it can see. Drop
 * `jsx` and every `.tsx` fixture stops parsing as JSX, and the rule that was being asserted simply
 * finds nothing.
 *
 * So this asserts the RESOLVED options rather than the text of the files — `extends` handled by
 * TypeScript, exactly as `createProgram` in `analyze.ts` has it, because that is the only thing that
 * proves the inheritance arrives.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

/** Every fixture directory, which is every directory here — the loose files are the shared stubs. */
const directories = readdirSync(fixtures, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** `analyze.ts`'s own two calls, so what is asserted is what the analyzer gets. */
function resolved(name: string): ts.ParsedCommandLine {
  const path = join(fixtures, name, "tsconfig.json");
  const file = ts.readConfigFile(path, ts.sys.readFile);
  expect(file.error, `${name}: unreadable config`).toBeUndefined();
  return ts.parseJsonConfigFileContent(file.config, ts.sys, dirname(path), undefined, path);
}

/** What the base says, and what a fixture therefore does not repeat. */
const SHARED = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: "..",
  strict: false,
  skipLibCheck: true,
  noEmit: true,
} as const;

describe("the fixture configs", () => {
  test("every fixture has one, so none of them is invisible to the analyzer", () => {
    for (const name of directories) {
      const listing = readdirSync(join(fixtures, name));
      expect(listing, `${name} has no tsconfig.json`).toContain("tsconfig.json");
    }
    // A floor rather than an exact count, so adding a fixture is not a two-file change. It is here
    // because the loop above passes vacuously if the directory listing ever comes back empty.
    expect(directories.length).toBeGreaterThan(60);
  });

  test("each one inherits the shared options instead of repeating them", () => {
    for (const name of directories) {
      const { options, errors } = resolved(name);
      expect(
        errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, " ")),
        name,
      ).toEqual([]);
      for (const [option, value] of Object.entries(SHARED)) {
        expect(options[option], `${name}: ${option} is not what the base says`).toBe(value);
      }
    }
  });

  test("and says nothing the base already says", () => {
    for (const name of directories) {
      const own = JSON.parse(readFileSync(join(fixtures, name, "tsconfig.json"), "utf8"));
      expect(own.extends, `${name} does not extend the base`).toBe("../tsconfig.base.json");
      // `paths` is the only compiler option a fixture declares. Anything else here is either a
      // duplicate of the base or a disagreement with it, and both are what the base exists to end.
      expect(Object.keys(own.compilerOptions ?? {}), name).toEqual(own.compilerOptions === undefined ? [] : ["paths"]);
    }
  });

  /**
   * The half of `extends` that can go wrong silently, and the reason `paths` and `include` stay in the
   * child.
   *
   * A relative path is resolved against the config that DECLARES it, and TypeScript records that as
   * `pathsBasePath`. A mapping moved into the base would resolve against `fixtures/`, so
   * `../framework.ts` would point one directory too high — and a mapping that resolves to nothing is
   * not an error, it is an import the analyzer cannot follow. The rule under test then reports nothing
   * and the test asserting it fails somewhere unrelated.
   */
  test("a `paths` mapping resolves against the fixture that declares it", () => {
    let mapping = 0;
    for (const name of directories) {
      const { options } = resolved(name);
      if (options.paths === undefined) continue;
      mapping += 1;
      expect(options.pathsBasePath, name).toBe(join(fixtures, name));
    }
    // A floor, for the same reason as the count above: eighteen fixtures map something today — a
    // vendor package, a stub, or core itself — and a nineteenth is not a reason for this to fail.
    expect(mapping).toBeGreaterThan(10);
  });

  /**
   * `include` is the other one, and it is the sharper of the two: `"."` in the base would mean all of
   * `fixtures/`, so every fixture would pull in every other one and every rule would report the whole
   * directory.
   */
  test("`include` stays in the fixture, so a fixture is only itself", () => {
    for (const name of directories) {
      const declared = JSON.parse(readFileSync(join(fixtures, name, "tsconfig.json"), "utf8"));
      expect(declared.include, `${name} declares no include`).toBeDefined();
      for (const file of resolved(name).fileNames) {
        const own = `${join(fixtures, name)}${sep}`;
        // The loose stubs beside the fixtures are the other legal answer: every `include` names
        // `../framework.ts` and `../jsx-runtime.ts`, and those are shared on purpose.
        expect(file.startsWith(own) || dirname(file) === fixtures, `${name}: ${file}`).toBe(true);
      }
    }
  });
});
