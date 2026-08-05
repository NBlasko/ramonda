import { describe, expect, it } from "vitest";
import { Fragment, jsx, jsxs } from "../jsx-runtime";
import { __h } from "../vdom/h";
import { Component } from "../base/Component";
import { IS_LIST } from "../helpers/constants";
import type { ComponentChild, RamondaNode } from "../types/vdom";

/**
 * The automatic runtime, against the classic factory.
 *
 * These two entry points look interchangeable and are not. `jsxs` gets children the compiler wrote
 * itself and must spread them, so each keeps its own index — the identity the diff matches on.
 * `jsx` gets ONE child, which may be an array from an expression, and must NOT spread it, because
 * an array child is a group with its own key space.
 *
 * Swap them and two sibling `.map()`s share a key index: the bug the grouping rule exists to stop,
 * and one no type can catch. So every case here is stated as "produces the same vnode as the
 * factory call it replaces".
 */

class Row extends Component {
  render(): RamondaNode {
    return <li>row</li>;
  }
}

const children = (node: RamondaNode): unknown[] => (node as { children: unknown[] }).children;
/** `h` returns `RamondaNode`, which is wider than what it takes as a child — the cast is that gap. */
const child = (node: RamondaNode): ComponentChild => node as ComponentChild;
const isGroup = (child: unknown): boolean =>
  child !== null && typeof child === "object" && (child as Record<symbol, unknown>)[IS_LIST] === true;

describe("the automatic runtime builds what the factory builds", () => {
  it("an element with no children", () => {
    expect(jsx("div", null)).toEqual(__h("div", null));
  });

  it("an element with attributes", () => {
    expect(jsx("div", { className: "a", children: "text" })).toEqual(__h("div", { className: "a" }, "text"));
  });

  it("children the compiler wrote are spread, one index each", () => {
    const runtime = jsxs("ul", { children: [child(__h("li", null, "a")), child(__h("li", null, "b"))] });
    expect(runtime).toEqual(__h("ul", null, child(__h("li", null, "a")), child(__h("li", null, "b"))));
    expect(children(runtime)).toHaveLength(2);
  });

  it("ONE child that is an array stays one group", () => {
    const rows = [__h(Row, {}), __h(Row, {})];
    const runtime = jsx("ul", { children: rows });

    expect(runtime).toEqual(__h("ul", null, child(rows as unknown as RamondaNode)));
    // The point: one child, and it is a group — not two children spliced into the parent.
    expect(children(runtime)).toHaveLength(1);
    expect(isGroup(children(runtime)[0])).toBe(true);
  });

  it("two sibling expressions stay two groups, each with its own key space", () => {
    const first = [__h(Row, { key: "a" })];
    const second = [__h(Row, { key: "a" })];
    // `<ul>{first}{second}</ul>` — the compiler writes two children, so this is `jsxs`.
    const runtime = jsxs("ul", { children: [first, second] });

    const kids = children(runtime);
    expect(kids).toHaveLength(2);
    expect(isGroup(kids[0])).toBe(true);
    expect(isGroup(kids[1])).toBe(true);
    // Same key on both sides and no collision, because they are different regions.
    expect(runtime).toEqual(
      __h("ul", null, child(first as unknown as RamondaNode), child(second as unknown as RamondaNode)),
    );
  });

  it("a present-but-undefined child still holds its slot", () => {
    // `<p>{undefined}</p>` has a child; `<p/>` does not, and the difference moves every
    // sibling's index.
    expect(children(jsx("p", { children: undefined }))).toHaveLength(1);
    expect(children(jsx("p", {}))).toHaveLength(0);
  });

  it("`key` arrives as an argument and lands where the diff reads it", () => {
    const runtime = jsx(Row, {}, "r1");
    expect((runtime as { attributes: { key?: unknown } }).attributes.key).toBe("r1");
    expect(runtime).toEqual(__h(Row, { key: "r1" }));
  });

  it("`children` never reaches the element as an attribute", () => {
    const attributes = (jsx("div", { children: "x", id: "d" }) as { attributes: Record<string, unknown> }).attributes;
    expect(attributes).toEqual({ id: "d" });
    expect("children" in attributes).toBe(false);
  });

  it("a component gets its props, and its children", () => {
    expect(jsx(Row, { children: "inner" })).toEqual(__h(Row, {}, "inner"));
  });
});

describe("fragments", () => {
  it("say what is wrong rather than half-working", () => {
    // The runtime contract requires the export. Ramonda has no fragment, because one tag producing
    // several elements is what the whole rule is against.
    expect(() => Fragment()).toThrow(/no fragments/);
  });
});
