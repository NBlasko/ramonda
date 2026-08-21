import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { htmlElements, svgElements } from "@ramonda/dom-facts";

/**
 * The HTML half of the same tripwire `SvgNamespace.test.tsx` sets for SVG.
 *
 * `htmlElements` exists so `@ramonda/check` can answer one question — whether a `@Host` tag names an
 * element at all — and the only honest source for it is what this framework TYPES as one. A name
 * that is typed and missing from the Set would be reported as no element by a checker that ships
 * with the framework accepting it, which is a rule reporting correct code. A name in the Set and no
 * longer typed is the mirror: a typo the checker waves through.
 *
 * `global.ts` is types-only, so nothing at runtime can read it — the check has to read the source,
 * exactly as the SVG one does.
 */
describe("the HTML element names the checker reads", () => {
  const source = readFileSync(resolve(__dirname, "../global.ts"), "utf8");

  /** Every `name: RamondaArgs<…>` entry declared in JSX.IntrinsicElements. */
  const typed = [...source.matchAll(/^\s*"?([A-Za-z][A-Za-z0-9-]*)"?: RamondaArgs</gm)].map((match) => match[1]);

  test("the instrument reads something at all", () => {
    // A guard on the instrument: a regex that matched nothing would make every assertion below
    // pass while checking nothing — the same trap the SVG test names.
    expect(typed.length).toBeGreaterThan(100);
  });

  test("every tag typed as HTML is in the Set", () => {
    expect(typed.filter((tag) => !htmlElements.has(tag))).toEqual([]);
  });

  test("and every name in the Set is still typed", () => {
    expect([...htmlElements].filter((tag) => !typed.includes(tag))).toEqual([]);
  });

  /** The two lists are disjoint: a name is created with `createElement` or with the SVG namespace. */
  test("nothing is in both", () => {
    expect([...htmlElements].filter((tag) => svgElements.has(tag))).toEqual([]);
  });
});
