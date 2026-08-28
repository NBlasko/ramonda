import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "mutation", "tsconfig.json"));

/**
 * A `@state` array or object changed in place — the static half of `RMD005` and `RMD048`.
 *
 * The runtime guard is a proxy over the value, so it sees the mutation happen. This sees the line
 * that would do it, and it mirrors the guard's two boundaries rather than inventing its own: only
 * plain objects and arrays, and only the mutating array methods. A rule drawing its own line would
 * disagree with the runtime about somebody's code, which is worse than either being narrow.
 */
describe("a state value changed in place", () => {
  test("every way of changing the held value is reported", () => {
    const found = run().findings["state-mutated-in-place"];
    expect(found.map((issue) => `${issue.field}:${issue.did}`)).toEqual([
      "items:push()",
      "user:`name` written",
      "items:an index written",
      "rows:push()",
      "owner:`name` written",
    ]);
  });

  /**
   * The state on a BASE, the mutation in the subclass — one instance, one signal.
   *
   * `stateFieldsOf` already walked the chain, so an inherited field was known to be state. What it
   * HOLDS was read from the subclass's own body, so a `@state rows: Row[] = []` on the base guarded
   * nothing and `this.rows.push(x)` went unreported — a rule that knew the field was state and not
   * what was in it. Found by planting, which is the only way a half-fixed walk shows itself.
   */
  test("a base's array and object are the subclass's to mutate wrongly", () => {
    const found = run().findings["state-mutated-in-place"];
    expect(found.filter((issue) => issue.component === "Restocked").map((issue) => issue.field)).toEqual([
      "rows",
      "owner",
    ]);
  });

  /** The fix must never be reported: `map`, `filter`, `slice` and a spread all return a new value. */
  test("a non-mutating method and a replacement are left alone", () => {
    const found = run().findings["state-mutated-in-place"];
    expect(found).toHaveLength(5);
    expect(found.every((issue) => issue.member === "seed")).toBe(true);
  });

  /**
   * The guard wraps only plain objects and arrays — a `Date`, a `Map` or a class instance goes
   * through untouched, because their methods need the real receiver. So neither half reports
   * `this.when.setHours(0)`, and neither reports a field that is not state.
   */
  test("a value the runtime guard does not wrap is not reported either", () => {
    const found = run().findings["state-mutated-in-place"];
    expect(found.some((issue) => issue.field === "when" || issue.field === "plain")).toBe(false);
  });
});

/**
 * Two class rules nobody had planted a shape for.
 *
 * `dom-writes` asks whose node this is; `unserializable-state` asks what a field holds. Both had
 * one gap, and both gaps were the same kind: a spelling one rule knew and its neighbour did not.
 */
describe("whose node it is, and what a field holds", () => {
  const domWrites = () =>
    (analyzeProject(join(here, "fixtures", "dom-write-shapes", "tsconfig.json")).findings["dom-writes"] ?? []).map(
      (issue) => issue.component,
    );

  /**
   * `const { body } = document` — the same node one NAME away.
   *
   * The checklist asks for a destructure to be planted whenever a rule matches a global, and this
   * rule had never had one planted: `body.style.overflow = "hidden"` bottoms out at an identifier,
   * so the walk found no `document` and said nothing, one class below the dotted form it reported.
   */
  test("a destructured document is still the document", () => {
    expect(domWrites()).toEqual(["Plain", "ViaGlobalThis", "Destructured", "OptionalChained"]);
  });

  test("and a command, or an element the component made itself, stays allowed", () => {
    // `focus()` and `scrollIntoView()` have no declarative form; `createElement` is the component's
    // own node. Neither appears above.
    expect(domWrites()).not.toContain("Commands");
    expect(domWrites()).not.toContain("OwnElement");
  });

  const state = () => analyzeProject(join(here, "fixtures", "state-shapes", "tsconfig.json")).findings;

  /**
   * A field with no initializer says what it holds in its type ANNOTATION.
   *
   * Read as SYNTAX — `Map<string, T>` is the name `Map` written in the file — never as a question
   * to the checker. The ungated sibling `persist-of-a-lossy-value` read it and this one did not,
   * which is the same question about the same hydration blob answered two ways. The shape matters:
   * `@state rows!: Map<…>` assigned in `@created` is how a value arriving from a fetch is written.
   */
  test("a `@state` field declared with an annotation and assigned later is read", () => {
    expect((state()["unserializable-state"] ?? []).map((issue) => issue.component)).toEqual([
      "Plain",
      "AssignedLater",
      "DateLater",
    ]);
  });

  test("a plain field is not in the blob, and a serializable one is fine", () => {
    const guilty = (state()["unserializable-state"] ?? []).map((issue) => issue.component);
    expect(guilty).not.toContain("PlainField");
    expect(guilty).not.toContain("Fine");
  });

  test("a field that is BOTH stays the ungated rule's, so one line gets one report", () => {
    expect((state()["persist-of-a-lossy-value"] ?? []).map((issue) => issue.component)).toEqual(["PersistedLater"]);
    expect((state()["unserializable-state"] ?? []).map((issue) => issue.component)).not.toContain("PersistedLater");
  });
});
