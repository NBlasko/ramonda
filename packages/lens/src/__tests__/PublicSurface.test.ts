import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect } from "vitest";
import * as api from "../index";

/**
 * What the package exports, asserted as a list.
 *
 * The same tripwire core has, and for the same reason: an export added for an
 * internal convenience silently becomes public API, and a published surface is
 * much harder to take back than to refuse. Adding something on purpose means
 * updating this list; adding it by accident fails the build.
 *
 * The docs' `check-api-coverage.mjs` reads this list too, so a new export has to
 * be acknowledged twice — once as API, once as documentation.
 */
const EXPECTED = ["focusOn"];

/**
 * The internals a consumer must not reach.
 *
 * The walk and the step shapes are the sharp ones: a caller able to build a
 * `Step` by hand could aim a write at a path the type system never checked,
 * which is the one thing the chain exists to prevent.
 */
const FORBIDDEN = [
  "walk",
  "replace",
  "removeAt",
  "collect",
  "shallowClone",
  "isContainer",
  "isUnsafeKey",
  "exoticName",
  "formatPath",
  "report",
  "fatal",
  "SPECS",
  "Chain",
  "NO_STEPS",
];

describe("public API surface", () => {
  test("exports exactly what it means to", () => {
    const actual = Object.keys(api).sort();
    const expected = [...EXPECTED].sort();

    const added = actual.filter((name) => !expected.includes(name));
    const removed = expected.filter((name) => !actual.includes(name));

    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  test("the internals are not reachable", () => {
    for (const name of FORBIDDEN) {
      expect(api).not.toHaveProperty(name);
    }
  });
});

/**
 * The TYPES the build publishes, which the list above cannot see.
 *
 * `Object.keys` reads values, and a type is erased before it gets there — so an internal type
 * re-exported by accident is public API that every check in this package would miss. It is not
 * hypothetical: this package declares `LensCode` and an ambient `RamondaDiagnostic`, both of them
 * internal, and both one `export *` away from being somebody's annotation.
 *
 * Read from the emitted `.d.ts` rather than from the source, because that file IS the published
 * surface: what tsup decided to include is the question, not what the entry looks like.
 */
describe("the published declarations", () => {
  const dts = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "index.d.ts");

  const declarations = (): string => {
    if (!existsSync(dts)) {
      throw new Error(`${dts} is not built. This asserts what the PUBLISHED types say, so run the build first.`);
    }
    return readFileSync(dts, "utf8");
  };

  test("publishes the five types it means to, and no others", () => {
    const exported = [...declarations().matchAll(/^export \{([^}]*)\};?/gms)]
      .flatMap(([, names]) => names.split(","))
      .map((name) => name.replace(/\btype\b/, "").trim())
      .filter(Boolean)
      .sort();

    expect(exported).toEqual(["ElementOf", "Focus", "FocusArray", "FocusCommon", "KeepSymbols", "focusOn"]);
  });

  test("keeps the diagnostics protocol out of the published surface", () => {
    const text = declarations();

    // Internal by intent: the registry's code union, and the ambient record shape. A consumer
    // installing a collector copies the record from the docs — which is the contract — rather
    // than importing a type from here, so neither may appear.
    expect(text).not.toContain("LensCode");
    expect(text).not.toContain("RamondaDiagnostic");
    expect(text).not.toContain("__RAMONDA_DIAGNOSTICS__");
  });
});
