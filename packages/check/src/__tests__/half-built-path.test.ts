import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "half-built-path", "tsconfig.json")).findings;
const found = () => run()["half-built-keyboard-path"] ?? [];
const said = () => found().map((issue) => `${issue.line}:${issue.role ?? "-"}/${issue.missing}`);

/**
 * A control built by hand, where the building stopped half way.
 *
 * A `role` is an announcement, not an implementation. It makes a screen reader say "button"; it
 * does not make Tab stop here and it does not make Enter do anything. Three pieces have to be
 * written out, and each way of stopping short fails differently: a control nobody is told about, a
 * control a reader cannot get to, and a control they get to, press, and watch do nothing.
 *
 * The report names the one to fix FIRST, not the first one written. A missing role comes ahead of
 * the others because it is the one nothing else compensates for — a control that is reachable and
 * operable still announces as text, and a reader who cannot tell it is a control will never try it.
 */
describe("a keyboard path somebody started and did not finish", () => {
  test("all three ways of stopping short, each named for the one to fix first", () => {
    expect(said()).toEqual([
      "12:button/the tab order",
      "16:button/a key handler",
      // The verbatim spelling of a click is the same handler, through the shared `eventTypeOf`.
      "20:link/a key handler",
      // 63 built the whole path and never said what it is; 67 started with the key handler alone.
      // Both report the ROLE, because it is the one nothing else compensates for.
      "63:-/a role",
      "67:-/a role",
    ]);
  });

  /**
   * Nine silences, and the first three are the finished control.
   *
   * 25 writes the whole path. 29 writes the key handler in the framework's second spelling, which
   * the shared reader knows. 33 is `tabIndex={-1}` — somebody choosing to move focus by script
   * rather than by Tab, which is a decision rather than an omission, so `has` is the question here
   * and not the number.
   *
   * 38 is a native `<button>`, which needs none of this written on it. 42 has a role that is not a
   * widget, so nothing was promised. 46 has a role this cannot read. 50 spreads, and the spread may
   * be carrying the `tabIndex` or the handler. 54 holds a real `<button>`, which is somewhere for
   * the keyboard to land. 58 has no pointer handler at all, so nothing on the line says the mouse
   * was wired and the keyboard was not.
   */
  test("the finished control, and everything this cannot claim, stay silent", () => {
    const lines = found().map((issue) => issue.line);
    for (const quiet of [25, 29, 33, 38, 42, 46, 50, 54, 58]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });

  /**
   * The sibling rule stays out of it, which is the whole point of writing this one.
   *
   * `click-with-no-keyboard-path` goes quiet the moment it sees a `role` or a `tabIndex`, and its
   * comment says a half-built path "is a different rule from this one". That rule did not exist, so
   * every element in this fixture was reported by nobody. The two enter on the same condition and
   * divide on whether the author had started.
   */
  test("and the two rules divide the territory with no overlap and no gap", () => {
    const sibling = (run()["click-with-no-keyboard-path"] ?? []).map((issue) => issue.line);
    const mine = found().map((issue) => issue.line);

    // 71 wrote NONE of the three, which is the sibling's whole subject and none of this rule's.
    expect(sibling).toEqual([71]);
    // And nothing is reported twice: the sibling returns the moment it sees any one of them.
    expect(mine.filter((line) => sibling.includes(line))).toEqual([]);
  });
});
