import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { __h } from "../index";

/**
 * `h()` does not write on the object it is handed.
 *
 * JSX builds a fresh props object per element, so nothing here shows through the
 * compiler — but `__h` is public and callable, and a caller may reasonably hold
 * one attributes object and use it for several elements.
 *
 * The `children` copy two lines below this in `CreateRamonda.ts` is there for
 * exactly that reason, and it is a MEASURED lesson: writing children onto the
 * caller's object meant a props object used for two elements ended up with only
 * the last one's children, and both rendered the same content. The `class` →
 * `className` normalisation was still mutating, so the same object came back
 * rewritten — and the warning that says to rename it fired only for whoever got
 * there first, because the second call no longer had a `class` to complain about.
 */
describe("the attributes object a caller passes in", () => {
  const logged: string[] = [];

  beforeEach(() => {
    logged.length = 0;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const renamedWarnings = () => logged.filter((line) => line.includes("`className`, not `class`"));

  test("is not rewritten by the class → className normalisation", () => {
    const shared = { class: "row", id: "one" };

    const vnode = __h("div", shared) as unknown as { attributes: Record<string, unknown> };

    // The vnode gets the corrected spelling…
    expect(vnode.attributes.className).toBe("row");
    expect("class" in vnode.attributes).toBe(false);

    // …and the caller's object is exactly as it was handed over.
    expect(shared).toEqual({ class: "row", id: "one" });
  });

  test("so one object used twice builds two correct elements", () => {
    const shared = { class: "row" };

    const first = __h("div", shared) as unknown as { attributes: Record<string, unknown> };
    const second = __h("span", shared) as unknown as { attributes: Record<string, unknown> };

    expect(first.attributes.className).toBe("row");
    expect(second.attributes.className).toBe("row");
    // Separate objects, or setting an attribute on one element would set it on the other.
    expect(first.attributes).not.toBe(second.attributes);
  });

  test("and the rename warning is not swallowed for everyone after the first", () => {
    const shared = { class: "row" };

    __h("div", shared);
    __h("span", shared);

    // Deleting `class` from the caller's object hid the mistake from every later
    // use of it — the warning is about the source, and the source still says `class`.
    expect(renamedWarnings()).toHaveLength(2);
  });

  test("an explicit className wins, and still nothing is written back", () => {
    const shared = { class: "from-class", className: "from-className" };

    const vnode = __h("div", shared) as unknown as { attributes: Record<string, unknown> };

    expect(vnode.attributes.className).toBe("from-className");
    expect(shared).toEqual({ class: "from-class", className: "from-className" });
  });
});
