import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { SVG_ELEMENTS } from "../rules/html";

/**
 * Pins this package's SVG tag list to the framework's.
 *
 * `@ramonda/check` depends on nothing but the compiler — deliberately, because a checker that
 * dragged the framework in could not be run first in a build. So the list is duplicated, and two
 * lists that have to agree is exactly the shape this whole package exists to complain about.
 *
 * It matters because it decides whether an attribute NAME survives as written: an HTML element gets
 * its attributes through `setAttribute`, which the specification lowercases, while an SVG element
 * gets them through `setAttributeNS(null, name)`, which does not. A tag missing here is an
 * `aria-labelledBy` reported as working when it is dead; a tag here that the framework does not
 * treat as SVG is correct markup reported as broken.
 *
 * Reading the other package's SOURCE rather than importing it keeps the dependency out of the
 * build while still failing when the two drift — the same trick the docs' coverage script uses.
 * Written as a first guess, this list was twenty-one tags short; every filter primitive was missing,
 * and `title` was in it, which the framework renders as HTML.
 */
const here = dirname(fileURLToPath(import.meta.url));
const constants = join(here, "..", "..", "..", "core", "src", "helpers", "constants.ts");

function frameworksList(): string[] {
  const source = readFileSync(constants, "utf8");
  const start = source.indexOf("export const svgElements");
  const end = source.indexOf("]", start);

  if (start === -1 || end === -1) {
    throw new Error(
      `[check] Could not find \`svgElements\` in ${constants}.\n` +
        `        Without it this test passes against nothing, which is worse than failing.`,
    );
  }

  const tags = [...source.slice(start, end).matchAll(/"([a-zA-Z]+)"/g)].map((match) => match[1]);
  // The floor is the same idea as the docs' `atLeast`: a parse that comes back nearly empty would
  // make every assertion below pass vacuously.
  if (tags.length < 30) {
    throw new Error(`[check] Read only ${tags.length} SVG tags from the framework — the parser broke.`);
  }
  return tags;
}

describe("the SVG tag list", () => {
  test("is exactly the framework's, in both directions", () => {
    const theirs = frameworksList();
    const missing = theirs.filter((tag) => !SVG_ELEMENTS.has(tag));
    const extra = [...SVG_ELEMENTS].filter((tag) => !theirs.includes(tag));

    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  /**
   * `title` is the sharp one: it is an SVG element in the specification AND an HTML element, and
   * the framework does not put it in the SVG namespace. Listing it here would make every
   * `<title>` in a document head read as SVG.
   */
  test("does not claim a tag the framework renders as HTML", () => {
    expect(SVG_ELEMENTS.has("title")).toBe(false);
    expect(SVG_ELEMENTS.has("a")).toBe(false);
    expect(SVG_ELEMENTS.has("script")).toBe(false);
  });
});
