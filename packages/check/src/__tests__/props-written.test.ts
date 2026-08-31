import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const at = join(here, "fixtures", "props-written");
const found = () => analyzeProject(join(at, "tsconfig.json")).findings["props-written-by-the-receiver"];

const lineOf = (label: string) => {
  const source = readFileSync(join(at, "app.tsx"), "utf8").split("\n");
  const line = source.findIndex((one) => one.includes(label));
  if (line < 0) throw new Error(`no line in the fixture holds ${label}`);
  return line + 1;
};

/**
 * A component or hook writing to its own props.
 *
 * `RMD004` and `RMD015` report it at runtime, and the report is the smaller half: the props bag is
 * a proxy that THROWS on a write, in every build. So this is not a wasteful shape that still works
 * — it is code that cannot run, which is why the severity is `error`.
 */
describe("props written by the component that received them", () => {
  test("every spelling of a write is reported, and nothing else is", () => {
    expect(found().map((issue) => issue.line)).toEqual([
      lineOf('this.props.label = "changed";'),
      lineOf('this.props.label += "!";'),
      lineOf("delete this.props.label;"),
      lineOf("n++;"),
      lineOf('p.label = "changed";'),
      lineOf('this.props[which] = "changed";'),
      lineOf("this.props.every = 10;"),
      lineOf('this.props.title = "changed";'),
    ]);
  });

  /**
   * A CAST is not a defence, and this one was planted before the rule existed and was missed:
   * `(this.props as { n: number }).n++` is a write to the same object, and reading the operand
   * without peeling the `as` reported nothing. `unwrap` is shared with `follow-value` rather than
   * copied, because a second copy is the one that never learns about the next wrapper.
   */
  test("a cast around the props bag does not hide the write", () => {
    const step = found().find((issue) => issue.how === "step");
    expect(step?.prop).toBe("n");
  });

  /** Three spellings of one fault, so the report says which rather than calling them all `=`. */
  test("assign, delete and step are told apart", () => {
    expect([...new Set(found().map((issue) => issue.how))].sort()).toEqual(["assign", "delete", "step"]);
  });

  /** A hook's props are the same object under the same proxy, which is why one rule answers both codes. */
  test("a hook's own props count too", () => {
    expect(found().map((issue) => issue.component)).toContain("Watcher");
  });

  /**
   * A PLAIN class is not a component, and this rule is an ERROR.
   *
   * `applyClass` runs only on a class the graph knows as a component or a hook, so an ordinary
   * class with a `props` field never reaches here — there is no proxy on it and the write runs
   * perfectly. Planted rather than read off the dispatch, because an error-severity rule reporting
   * working code is the one thing this package may not do.
   */
  test("a plain class with a `props` field is not a component and is not reported", () => {
    expect(found().map((issue) => issue.component)).not.toContain("NotAComponent");
  });

  /**
   * The silences, each a different reason.
   *
   * Mutating what props POINT AT sets a key on that object, not on the props bag, so the proxy
   * never sees it and nothing throws — a real fault of another kind, and calling it this one would
   * name a throw that does not happen. A destructured value is a local. Reading is the point. And
   * another object called `props` is not the subject; `this.props` is.
   */
  test("nested mutation, a destructured local, a read and a different `props` are all silent", () => {
    const lines = found().map((issue) => issue.line);

    for (const label of [
      "this.props.meta.seen = true;",
      'this.props.rows.push("x");',
      'label = "a local, not a prop";',
      "return this.props.label;",
      'other.props.label = "changed";',
    ]) {
      expect(lines, label).not.toContain(lineOf(label));
    }
    expect(lines).toHaveLength(8);
  });
});
