import { describe, expect, test } from "vitest";
import * as submodule from "../bguard";
import * as api from "../index";

/**
 * `@ramonda/form/bguard` is the second door — the one that reaches for bguard, so `index.ts` does
 * not have to. A second door is only safe while it stays narrow, and nothing about an `export { … }`
 * line makes it stay narrow.
 *
 * The same job `TestingSeam.test.ts` does for `@ramonda/core/testing`, and it exists because the
 * mistake it catches — an internal becoming API by accident — is invisible in a diff and permanent
 * once shipped.
 */

const EXPECTED = ["htmlConstraints", "unknownRefPaths"];

/** Erased at runtime, so listed for the docs check to read and proved by the import below. */
const EXPECTED_TYPES = ["HtmlConstraints", "UnknownRef"];

describe("the bguard submodule's surface", () => {
  test("exports exactly the two things it exists for", () => {
    expect(Object.keys(submodule).sort()).toEqual([...EXPECTED].sort());
  });

  test("does not re-export anything the main entry already offers", () => {
    // A name reachable through two doors is a name with two documentation homes and two chances to
    // drift. bguard's own helpers belong to bguard, and a consumer imports them from there.
    for (const name of Object.keys(submodule)) {
      expect(api, `${name} is reachable from both entries`).not.toHaveProperty(name);
    }
  });

  test("does not leak bguard's own exports through this package", () => {
    // `readsAffectedBy` was briefly re-exported here. Passing someone else's function through
    // makes this package look like it owns it, and pins its signature to our releases.
    expect(submodule).not.toHaveProperty("readsAffectedBy");
    expect(submodule).not.toHaveProperty("toJSONSchema");
    expect(submodule).not.toHaveProperty("parse");
  });

  test("reaches nothing from @ramonda/core, so it needs no DOM", async () => {
    // `unknownRefPaths` belongs in a plain unit test and `htmlConstraints` may well run on a
    // server. Pulling core in would make both require a rendered component or a jsdom, for nothing:
    // neither function touches a component, a signal or an element.
    // Read through the working directory rather than `import.meta.url`: under vitest the module
    // URL is not a `file:` one, and `new URL(…)` on it throws.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "src/bguard.ts"), "utf8");

    expect(source).not.toContain('from "@ramonda/core"');
    expect(source).not.toContain("./Form");
    expect(source).not.toContain("./fieldTree");
  });

  test("every published type is named in EXPECTED_TYPES", () => {
    expect(new Set(EXPECTED_TYPES).size).toBe(EXPECTED_TYPES.length);
    expect(EXPECTED_TYPES).toEqual([...EXPECTED_TYPES].sort());
  });
});

// Named once so `check-types` fails if either is renamed or removed.
import type { HtmlConstraints, UnknownRef } from "../bguard";

type _Surface = [HtmlConstraints, UnknownRef];
