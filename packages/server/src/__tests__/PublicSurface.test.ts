import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import * as api from "../index";

/**
 * What the package exports, asserted as a list.
 *
 * The same tripwire the other packages have: an export added for an internal convenience silently
 * becomes public API, and a published surface is much harder to take back than to refuse. Adding
 * something on purpose means updating this list; adding it by accident fails the build.
 *
 * The docs' `check-api-coverage.mjs` reads this list too, so a new export has to be acknowledged
 * twice — once as API, once as documentation.
 */
const EXPECTED = [
  "escapeHtml",
  "fillDocument",
  "installDom",
  "installWindow",
  "mimeFor",
  "parseCookies",
  "PORTAL_TARGET_ATTR",
];

/**
 * The TYPES the build publishes, which `Object.keys` cannot see.
 *
 * Both are the shape of something this package hands BACK — the parsed shell, and the handle that
 * undoes a DOM installation — so both are written in an annotation by anybody who keeps one in a
 * variable, which makes them API whether or not they were meant to be.
 */
const EXPECTED_TYPES = ["Document", "DomHandle"];

/**
 * The internals a consumer must not reach.
 *
 * This package exists because every SSR app had grown its own copy of this plumbing and the copies
 * drifted. The thing that must not leak is therefore anything that lets an app write its own half
 * of it again — a raw shell splitter, a global it installed — because a half-used installer is the
 * shape of the bug the package was written to end.
 */
const FORBIDDEN = ["installGlobals", "restore", "split", "shell", "SPECS", "report"];

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
 * The declarations the build actually publishes.
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

  test("publishes the names it means to, and no others", () => {
    const exported = [...declarations().matchAll(/^export \{([^}]*)\};?/gms)]
      .flatMap(([, names]) => names.split(","))
      .map((name) => name.replace(/\btype\b/, "").trim())
      .filter(Boolean)
      .sort();

    expect(exported).toEqual([...EXPECTED, ...EXPECTED_TYPES].sort());
  });

  test("every published type is named in EXPECTED_TYPES", () => {
    expect(new Set(EXPECTED_TYPES).size).toBe(EXPECTED_TYPES.length);
    expect(EXPECTED_TYPES).toEqual([...EXPECTED_TYPES].sort());
  });
});

// Both published types, named once, so `check-types` fails if either is renamed or removed.
import type { Document, DomHandle } from "../index";

type _Surface = [Document, DomHandle];
