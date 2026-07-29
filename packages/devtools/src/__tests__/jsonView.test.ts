import { describe, expect, it } from "vitest";
import { FULL, INLINE, renderJsonHtml, summarize, toPrettyText } from "../jsonView";

/**
 * The value renderer on its own, where the bounds are easiest to state exactly.
 *
 * The panel tests cover it in place; these cover the edges a component tree does not happen to
 * produce — a class instance, a `Date`, a value nested deeper than the cap, a container so wide the
 * budget runs out mid-row.
 */

const text = (value: unknown, options = INLINE) =>
  renderJsonHtml(value, options)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

describe("summarize", () => {
  it("names a container by its size", () => {
    expect(summarize([1, 2, 3])).toBe("Array(3)");
    expect(summarize({ a: 1 })).toBe("{1 key}");
    expect(summarize({ a: 1, b: 2 })).toBe("{2 keys}");
    expect(summarize({})).toBe("{}");
  });

  it("shows a leaf as itself", () => {
    expect(summarize("hi")).toBe('"hi"');
    expect(summarize(42)).toBe("42");
    expect(summarize(null)).toBe("null");
    expect(summarize(undefined)).toBe("undefined");
  });
});

describe("what is walked and what is named", () => {
  it("walks arrays and plain objects", () => {
    expect(text({ list: [1, 2] })).toContain("list");
    expect(text({ list: [1, 2] })).toContain("Array(2)");
  });

  /**
   * Anything with a prototype of its own is NAMED, not walked. Equality and shape for a Date, a Map
   * or a class instance are the app's business, and a panel that guessed would be confidently wrong
   * — `{}` for a Map being the classic version of that.
   */
  it("names anything with a prototype of its own", () => {
    class Point {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }

    expect(text({ when: new Date("2020-01-01T00:00:00Z") })).toContain("2020");
    expect(text({ m: new Map([["a", 1]]) })).toContain("Map");
    expect(text({ p: new Point(1, 2) })).toContain("Point");
    expect(text({ f: () => 1 })).toContain("ƒ()");
    expect(text({ b: 10n })).toContain("10n");
  });

  it("does not open past the first level inline, and opens two levels in the full view", () => {
    const value = { a: { b: { c: 1 } } };
    const inline = renderJsonHtml(value, INLINE);
    const full = renderJsonHtml(value, FULL);

    expect(inline.match(/<details class="jv-node" open>/g)!.length).toBe(1);
    expect(full.match(/<details class="jv-node" open>/g)!.length).toBe(2);
  });
});

describe("the bounds, and saying so", () => {
  it("stops at the depth cap and names what it stopped at", () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 30; i++) deep = { down: deep };

    const rendered = text(deep, { openDepth: 40, budget: 5000, maxDepth: 5 });
    expect(rendered).toContain("too deep to show");
    expect(rendered).not.toContain("end");
  });

  it("stops at the node budget and says how many it dropped", () => {
    const rendered = text({ rows: Array.from({ length: 50 }, (_, i) => i) }, { budget: 12, maxDepth: 20 });

    expect(rendered).toMatch(/… \d+ more/);
    // The count is what was dropped from THAT container, not a guess.
    expect(rendered).toContain("more — open the full view");
  });

  it("names a cycle rather than following it", () => {
    const loop: Record<string, unknown> = { name: "a" };
    loop.self = loop;
    loop.list = [loop];

    const rendered = text(loop);
    expect(rendered.match(/\[circular\]/g)!.length).toBe(2);
  });

  it("escapes what it renders", () => {
    expect(renderJsonHtml({ "<b>": "</script>" })).not.toContain("<b>");
    expect(renderJsonHtml({ "<b>": "</script>" })).toContain("&lt;b&gt;");
  });
});

describe("the copy button's text", () => {
  it("is the whole value, pretty-printed", () => {
    expect(toPrettyText({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
  });

  it("falls back rather than throwing on something unserializable", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => toPrettyText(loop)).not.toThrow();
  });
});
