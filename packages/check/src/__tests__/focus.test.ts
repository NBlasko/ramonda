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
      "empty href:false",
    ]);
  });

  test("a real destination, one this cannot read, and an anchor target are all silent", () => {
    const found = run().findings["link-without-a-destination"];
    // Ten `<a>` in the fixture and six reported, so a leak is a count rather than a line number.
    expect(found).toHaveLength(6);
  });
});

/**
 * A control a pointer can use and a keyboard cannot.
 *
 * The silence is what decides whether this ships: "click anywhere on the card" is written
 * constantly and works, because the real control is one level in.
 */
describe("a click handler with no keyboard path", () => {
  test("a pointer-only handler on a plain element is reported", () => {
    const found = run().findings["click-with-no-keyboard-path"];
    expect(found.map((issue) => `${issue.tag}:${issue.handler}`)).toEqual([
      "div:onclick",
      "span:onmousedown",
      // The OLD spelling, kept on purpose: core's types refuse it now, but a project with no types
      // still compiles it and the rule has to see it. The lookup is lower-cased, so both arrive.
      "span:onMouseUp",
    ]);
  });

  test("a wrapper around a real control is left alone", () => {
    const found = run().findings["click-with-no-keyboard-path"];
    // Nine elements in that component carry a handler or look like they might; two are reported.
    expect(found).toHaveLength(3);
  });

  /**
   * The exclusion the first version of this rule did not have, and its absence showed immediately:
   * run against this repository's documentation site it reported two backdrops, and both were
   * correct markup — a backdrop's click is a convenience beside Escape and a close button.
   *
   * The line drawn is structural rather than a guess at a class name: an element with CONTENT
   * presents itself as something to do; an empty one announces nothing and is a hit area.
   */
  test("an empty element is a backdrop, not a control", () => {
    const found = run().findings["click-with-no-keyboard-path"];
    expect(found.some((issue) => issue.tag === "div" && issue.handler === "onClick" && found.length > 2)).toBe(false);
    expect(found).toHaveLength(3);
  });
});

/**
 * A keyboard path, and what is really inside what.
 *
 * Two rules nobody had ever planted a shape for, and three gaps between them — one of them a report
 * against an element whose keyboard handler is written on the same line.
 */
describe("a click a keyboard cannot reach, and a control inside itself", () => {
  const found = () => analyzeProject(join(here, "fixtures", "keyboard-path", "tsconfig.json")).findings;
  const clicks = () => (found()["click-with-no-keyboard-path"] ?? []).map((issue) => issue.line);
  const nested = () => (found()["interactive-inside-interactive"] ?? []).map((issue) => issue.line);

  /**
   * The framework takes TWO spellings of an event name, and this rule knew one.
   *
   * `on:click` hands the name through verbatim, for a custom event with a dash or a capital that
   * `onclick` cannot reach — `core/Attribute.ts` decides it, and `eventTypeOf` mirrors that rather
   * than inventing an answer. Read as `onclick` only, `<div on:click={open}>` was not a click
   * handler at all (11 is reported and 14 was not), and — worse — the key handler in
   * `<div onclick={open} on:keydown={onKey}>` was invisible, so an element with a keyboard path
   * written on the same line was reported as having none.
   */
  test("both spellings of a click are clicks, and both spellings of a key handler are a path", () => {
    expect(clicks()).toEqual([11, 14]);
  });

  /** The plain nesting, as the control for the rule that shares this fixture. */
  test("a link inside a link is still reported", () => {
    expect(nested()).toEqual([28]);
  });
});
