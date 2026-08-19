import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "host-listeners", "tsconfig.json"));

/**
 * `RMD042`, said before the page is opened.
 *
 * A component with no `@Host` gets `<ramonda-host style="display: contents">`, which generates no
 * box — so it can never be the direct target of a pointer event. Both halves of the decorator are
 * syntax, so the pair is provable without asking anything about types.
 */
describe("a listener on the default host", () => {
  test("a non-bubbling event on a boxless host is reported, with the event named", () => {
    const found = run().findings["listener-on-the-default-host"];
    expect(found.map((issue) => `${issue.component}.${issue.member}:${issue.event}`)).toEqual([
      "Bare.onEnter:mouseenter",
      "Bare.onFocus:focus",
    ]);
  });

  /**
   * The narrowing, and it came from the rule being questioned rather than from reading it.
   *
   * A click on a CHILD of a boxless host reaches the listener perfectly well — measured in core: the
   * handler ran and the count went up. Bubbling needs an ANCESTOR, not a box, and the host is one.
   * So a bubbling listener there is not a fault, and the first version reported working code, which
   * is the one thing this package refuses to do. `RMD042` was narrowed to match.
   */
  test("a bubbling event is not reported, because it arrives", () => {
    const found = run().findings["listener-on-the-default-host"];
    expect(found.some((issue) => issue.event === "click" || issue.event === "input")).toBe(false);
  });

  /** `@onWindow` and `@onDocument` resolve to the globals, so the host has nothing to do with them. */
  test("the window and document decorators are not this rule's business", () => {
    const found = run().findings["listener-on-the-default-host"];
    expect(found.every((issue) => issue.component === "Bare")).toBe(true);
  });

  /**
   * `@Host` is read from the constructor, so a subclass of a `@Host`-ed base has a real element —
   * the heritage is walked for exactly that reason, and a component that inherits its host must not
   * be reported.
   */
  test("a real element, declared or inherited, is silent", () => {
    const found = run().findings["listener-on-the-default-host"];
    expect(found.some((issue) => issue.component === "Boxed" || issue.component === "Inherits")).toBe(false);
    expect(found).toHaveLength(2);
  });
});
