import { afterEach, describe, expect, test, vi } from "vitest";
import { Component } from "../base/Component";
import { getDOM } from "../test/setup";

/**
 * What we ASK the DOM to create, which is not the same question as what we get back.
 *
 * `h` uppercases an HTML tag on purpose — a real node reports `nodeName` uppercase, the diff compares
 * against it every pass, and converting once at construction beats converting on every comparison.
 * The name therefore reaches `createElement` as `"DIV"`.
 *
 * A browser and jsdom lowercase a createdTags element's local name in an HTML document, so that has
 * always been invisible: every existing test passes either way. A partial DOM does not normalise —
 * linkedom keeps what it is handed and served `<DIV id="page">` — so this is asserted at the call
 * rather than at the result, because the result is exactly what hides it.
 */

const createdTags: string[] = [];
const createdNS: [string, string][] = [];

function watchCreation(): void {
  const element = document.createElement.bind(document);
  const elementNS = document.createElementNS.bind(document);

  vi.spyOn(document, "createElement").mockImplementation(((tag: string, ...rest: unknown[]) => {
    createdTags.push(tag);
    return element(tag, ...(rest as []));
  }) as typeof document.createElement);

  vi.spyOn(document, "createElementNS").mockImplementation(((ns: string, tag: string, ...rest: unknown[]) => {
    createdNS.push([ns, tag]);
    return elementNS(ns, tag, ...(rest as []));
  }) as typeof document.createElementNS);
}

afterEach(() => {
  createdTags.length = 0;
  createdNS.length = 0;
  vi.restoreAllMocks();
});

describe("the tag name we hand to the DOM", () => {
  test("an HTML element is createdTags in lower case", async () => {
    watchCreation();

    class Page extends Component {
      render() {
        return (
          <div id="page">
            <h1>Hello</h1>
            <input name="email" />
            <br />
          </div>
        );
      }
    }

    await getDOM<Page>(<Page />);

    // Every one, not just the first: a single uppercase name is a page that shouts in view-source.
    const shouted = createdTags.filter((tag) => tag !== tag.toLowerCase());
    expect(shouted).toEqual([]);
    expect(createdTags).toContain("div");
    expect(createdTags).toContain("h1");
    expect(createdTags).toContain("input");
  });

  test("the host element too", async () => {
    // `HOST_TAG` is written `"RAMONDA-HOST"`, so it is the one name that is uppercase at the source.
    watchCreation();

    class Page extends Component {
      render() {
        return <p>x</p>;
      }
    }

    await getDOM<Page>(<Page />);

    expect(createdTags).toContain("ramonda-host");
    expect(createdTags).not.toContain("RAMONDA-HOST");
  });

  test("an SVG element keeps the case it was written with", async () => {
    // SVG names are case-SENSITIVE, and `h` never uppercases them for that reason. Lowercasing here
    // would turn `linearGradient` into `lineargradient`, which is a different element and renders
    // nothing — the kind of failure that only shows up on a page that happens to have a gradient.
    watchCreation();

    class Chart extends Component {
      render() {
        return (
          <svg viewBox="0 0 10 10">
            <defs>
              <linearGradient id="g">
                <stop offset="0" />
              </linearGradient>
            </defs>
            <clipPath id="c" />
            <circle cx="5" cy="5" r="4" />
          </svg>
        );
      }
    }

    await getDOM<Chart>(<Chart />);

    const svgTags = createdNS.map(([, tag]) => tag);
    expect(svgTags).toContain("linearGradient");
    expect(svgTags).toContain("clipPath");
    expect(svgTags).toContain("circle");
    // And none of them went through the HTML path, which is where the lowercasing lives.
    expect(createdTags).not.toContain("lineargradient");
    expect(createdTags).not.toContain("clippath");
  });

  test("the SVG element still renders, so the case is not merely requested but honoured", async () => {
    class Chart extends Component {
      render() {
        return (
          <svg>
            <defs>
              <linearGradient id="grad" />
            </defs>
          </svg>
        );
      }
    }

    const app = await getDOM<Chart>(<Chart />);

    // `querySelector` on an SVG name is case-sensitive in the DOM, so finding it proves the element
    // really is a `linearGradient` rather than something that merely looked like one at creation.
    expect(app.container.querySelector("linearGradient")?.id).toBe("grad");
  });
});
