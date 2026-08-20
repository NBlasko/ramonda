import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "dom-writes", "tsconfig.json"));

/**
 * A class, an attribute or a piece of text written onto the document is a SECOND copy of state the
 * component already holds: kept in step by hand, cleaned up on unmount by hand, and remembered by
 * whoever adds the next handler. The declarative form exists and cannot drift, because there is
 * only one of it.
 */
describe("a component writing the document instead of rendering it", () => {
  /**
   * Four of these nine were invisible when the rule was first written, and the first of them is the
   * one it most exists for: `className += " open"` is how an imperative class write is usually
   * spelled, and matching only `=` left the rule silent on it. A style reached through a call or a
   * computed key was the other half — `setProperty("--accent", …)` is how a component pushes theme
   * state onto the document.
   */
  test("every shape of write is reported", () => {
    expect(run().findings["dom-writes"].map((w) => w.wrote)).toEqual([
      "document.documentElement.classList.toggle",
      "document.body.className",
      "document.body.style.overflow",
      'document.getElementById("panel")?.setAttribute',
      'document.querySelector(".badge")!.textContent',
      "document.body.className",
      "document.body.style.setProperty",
      'document.body.style["overflow"]',
      "document.documentElement.innerHTML",
      // One `this.method()` away, which is where a write like this actually lives.
      "document.body.classList.add",
    ]);
  });

  /**
   * How far it looks: the whole class, and no further.
   *
   * A write in a helper the component calls is found. A utility in ANOTHER FILE is not, and that is
   * a decision — the report names a component and a line with nothing to say how the two are
   * connected, and a module that owns a DOM effect on purpose (a focus trap, a scroll lock) is a
   * legitimate thing to write that this rule could not tell from the other kind.
   */
  test("a write one this.method() away is found, and one across a file boundary is not", () => {
    const components = run().findings["dom-writes"].map((issue) => issue.component);
    expect(components).toContain("WritesViaAHelper");
    expect(components).not.toContain("WritesViaAnotherFile");
  });

  /**
   * The line the whole rule turns on. A command tells the browser to DO something and has no
   * declarative form — `scrollIntoView`, `focus`, `getBoundingClientRect`. A rule that caught those
   * would be a rule people switch off, and it would be wrong: there is nothing else to write.
   */
  test("a command is not a write", () => {
    expect(run().findings["dom-writes"].some((w) => w.component === "Commanding")).toBe(false);
  });

  /**
   * An element the component created is its own to fill in. It is reached through a local, and
   * reading what a local holds is dataflow — refused by decision — so this falls out of the design
   * rather than needing a case of its own.
   */
  test("an element the component built itself is left alone", () => {
    expect(run().findings["dom-writes"].some((w) => w.component === "Building")).toBe(false);
  });

  /**
   * A WARNING for now, which is the rule here for a new rule: one version that says so, the next
   * that refuses.
   */
  test("it does not fail the run", () => {
    const result = run();
    expect(result.findings["dom-writes"].length).toBeGreaterThan(0);
    expect(result.issues).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });
});
