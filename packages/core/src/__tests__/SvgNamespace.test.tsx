import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDOM } from "../test/setup";
import { Component, Host } from "../index";
import { svgElements, svgNamespaceUri } from "../helpers/constants";

/**
 * Which namespace an element is created in — and the tripwire that keeps the two
 * lists that decide it from drifting apart.
 *
 * Ramonda decides SVG-ness by TAG NAME (`svgElements.has(name)` in `h.ts`), not by
 * tree context: an element is SVG because it is called `tspan`, not because it
 * happens to sit under an `<svg>`. That is what makes `<div>` inside
 * `<foreignObject>` come out as HTML, which is what SVG itself requires — but it
 * also means the runtime Set is the ONLY thing standing between a typed SVG tag
 * and an HTML element wearing its name.
 *
 * A name missing from the Set fails quietly and late. `document.createElement`
 * accepts anything, so `<tspan>` becomes an unknown HTML element: it lowercases to
 * `tspan` either way, `querySelector` still finds it, the DOM still contains it,
 * and it simply never renders as SVG. Nothing throws — the picture is just wrong.
 *
 * So this file checks the two directions that matter:
 *  1. the elements themselves land in the SVG namespace with their case intact;
 *  2. every tag `global.ts` TYPES as SVG is in the runtime Set — because the types
 *     are what tells an app the tag is supported, and the Set is what makes it true.
 */

const SVG_NS = svgNamespaceUri;
const HTML_NS = "http://www.w3.org/1999/xhtml";

describe("SVG namespace", () => {
  test("every typed SVG tag is created in the SVG namespace, with its case kept", async () => {
    @Host("div")
    class Chart extends Component {
      render() {
        return (
          <svg viewBox="0 0 24 24">
            <desc />
            <metadata />
            <text>
              <tspan />
              <textPath />
            </text>
            <foreignObject>
              {/* HTML inside SVG: correct precisely BECAUSE the tag name decides. */}
              <div />
            </foreignObject>
            <image />
            <switch />
            <mpath />
          </svg>
        );
      }
    }

    const app = await getDOM<Chart>(<Chart />);
    await app.settle();

    // Looked up by local name rather than with a CSS selector: a type selector is
    // ASCII case-insensitive against an HTML element and case-SENSITIVE against an
    // SVG one, so `querySelector("foreignObject")` matches both the right answer
    // and the bug. `localName` states which one is actually there.
    const byLocalName = new Map<string, Element>();
    for (const node of app.container.querySelectorAll("*")) {
      byLocalName.set(node.localName, node);
    }

    // The eight that were typed but not listed. `tspan`, `textPath`,
    // `foreignObject` and `image` are the everyday ones.
    for (const name of ["desc", "foreignObject", "image", "metadata", "mpath", "switch", "textPath", "tspan"]) {
      const element = byLocalName.get(name);
      expect(element, `<${name}> is missing — the tag name did not survive`).toBeDefined();
      expect(element?.namespaceURI, `<${name}> is in the wrong namespace`).toBe(SVG_NS);
    }

    // Case is part of the identity: in the SVG namespace `foreignObject` is a real
    // element and `foreignobject` is an unknown one, so an HTML-namespace node
    // would show up here under the lowercased name instead.
    expect(byLocalName.has("foreignobject")).toBe(false);
    expect(byLocalName.has("textpath")).toBe(false);

    // The tag-name rule, the other way round: HTML under <foreignObject> stays HTML.
    expect(byLocalName.get("div")?.namespaceURI).toBe(HTML_NS);
  });

  /**
   * `global.ts` is types-only, so nothing at runtime can read it — the check has to
   * be made against the source. That is the point: the two lists live in different
   * files and neither one imports the other, which is exactly how they drifted.
   */
  describe("the runtime Set and the JSX types agree", () => {
    const globalSource = readFileSync(resolve(__dirname, "../global.ts"), "utf8");

    /** Every `name: SVGArgs<…>` entry declared in JSX.IntrinsicElements. */
    function typedSvgTags(source: string): string[] {
      return [...source.matchAll(/^\s*([A-Za-z]+): SVGArgs</gm)].map((match) => match[1]);
    }

    test("the parser finds the declarations it is meant to check", () => {
      const tags = typedSvgTags(globalSource);
      // A guard on the instrument: a regex that matched nothing would make the
      // assertion below pass while checking nothing at all.
      expect(tags.length).toBeGreaterThan(50);
      expect(tags).toContain("svg");
      expect(tags).toContain("tspan");
      // And a name that is typed as HTML must not be swept in.
      expect(tags).not.toContain("div");
    });

    test("no tag is typed as SVG without being in svgElements", () => {
      const untyped = typedSvgTags(globalSource).filter((tag) => !svgElements.has(tag));

      // Anything listed here would be created as an HTML element despite being
      // offered to apps as SVG.
      expect(untyped).toEqual([]);
    });

    test("no tag is in svgElements without being typed as SVG", () => {
      const typed = new Set(typedSvgTags(globalSource));
      const unreachable = [...svgElements].filter((tag) => !typed.has(tag));

      // The opposite drift: a name the runtime treats as SVG that no app can
      // actually write, because JSX would reject it.
      expect(unreachable).toEqual([]);
    });
  });
});
