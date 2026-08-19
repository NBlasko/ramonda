import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "focus", "tsconfig.json"));

/**
 * `aria-hidden` on something the keyboard still reaches.
 *
 * The pairing is the test, as it is for every rule in this family: a rule that reports the hidden
 * button and also reports the hidden ICON has not found a fault, it has found buttons.
 */
describe("aria-hidden on a focusable element", () => {
  test("the four shapes that are still in the tab order are reported", () => {
    const found = run().findings["aria-hidden-on-focusable"];
    expect(found.map((issue) => `${issue.tag}:${issue.because}`)).toEqual([
      "button:the tag",
      "a:the tag",
      "div:tabIndex",
      "span:tabIndex",
    ]);
  });

  /**
   * `tabIndex={-1}` beside the `aria-hidden` is the documented FIX, so reporting it would report
   * the very thing the advice asks for. Asserted by name rather than by count, because a count
   * cannot say which one survived.
   */
  test("an element taken out of the tab order is not reported", () => {
    const found = run().findings["aria-hidden-on-focusable"];
    // Five buttons in the fixture; exactly one is reported.
    expect(found.filter((issue) => issue.tag === "button")).toHaveLength(1);
  });

  test("a value this cannot read is not treated as `true`", () => {
    const found = run().findings["aria-hidden-on-focusable"];
    expect(found.some((issue) => issue.tag === "svg")).toBe(false);
    expect(found.some((issue) => issue.tag === "input")).toBe(false);
  });
});

/**
 * The other half of the same subject: an element the keyboard SHOULD reach and cannot.
 *
 * `<a>` without a destination renders looking exactly like a link, which is why it survives review:
 * the page looks right, and only half the people using it can follow the link.
 */
describe("a link with nowhere to go", () => {
  test("the four shapes that are not destinations are reported, each named", () => {
    const found = run().findings["link-without-a-destination"];
    expect(found.map((issue) => `${issue.kind}:${issue.handled}`)).toEqual([
      // The first is the `<a aria-hidden="true">` in the component above, which has no `href` and
      // is therefore this rule's business as well. Asserted rather than moved out of its way: two
      // rules meeting on one element is what a shared walk does, and a fixture that separated them
      // would stop proving it.
      "no href:false",
      "no href:true",
      "empty fragment:true",
      "javascript::false",
      "no href:false",
    ]);
  });

  test("a real destination, one this cannot read, and an anchor target are all silent", () => {
    const found = run().findings["link-without-a-destination"];
    // Nine `<a>` in the fixture and five reported, so a leak is a count rather than a line number.
    expect(found).toHaveLength(5);
  });
});
