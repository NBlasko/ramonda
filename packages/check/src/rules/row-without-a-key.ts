import { positionOf } from "../syntax";
import { openingOf } from "./element";
import { rowCallbackFor } from "./row-callback";
import type { ElementRule } from "./rule";

/**
 * A row built from data, with no `key` on it.
 *
 * Two ways to build rows and both are covered, because the argument for writing a key is the same
 * on both sides and the consequence of leaving it out only differs in how quietly it fails.
 *
 * **From `.map()`**, rows have no identity at all without a key: they are matched by POSITION. Add
 * or remove anywhere but the end and every row below it inherits the previous row's state and DOM —
 * a half-typed input, an open menu, a scroll position, all one row off, while the page still looks
 * right. That is `RMD023` at runtime.
 *
 * **From `list()`**, the framework derives an identity from what makes a row different from its
 * siblings, and a hand-written key wins over it — the engine's own words are that yours wins and it
 * only fills in when there is none. So a key here is not redundant; it is the difference between an
 * identity you chose and one that was inferred. The inferred one can fail, which is what `RMD051`
 * exists to say: a row whose every field is nested or shared with its siblings has nothing to be
 * told apart by, and is rebuilt whenever the data is replaced.
 *
 * And the case where inference matters most is the commonest one in an application: data that
 * arrives fresh. A refetch, a `JSON.parse`, a `.map()` over a response — every object is new, so
 * there is no reference to recognise and the key is all there is.
 */
export interface RowWithoutAKeyIssue {
  /** The tag of the row. */
  tag: string;
  /** How the rows are built, because the two need different advice. */
  via: "map" | "list";
  file: string;
  line: number;
  column: number;
}

export const rowWithoutAKey = {
  id: "row-without-a-key",

  report: {
    severity: "error",
    reportedWhen: "a row built by `map` or by `list()` has no `key`",
    // `RMD023` is the `map` half — no identity at all. `RMD051` is the `list()` half: an identity
    // was inferred and could not tell the row from its siblings. This rule reports the source of
    // both, which is a row whose identity nobody chose.
    alsoReportedAs: ["RMD023", "RMD051"],
    /**
     * The heading names WHICH way the rows were built, when they were all built one way.
     *
     * Read against this repository, every one of the seven reports was a `list()` — and the advice
     * below has to cover both, so it opens with the other case. A heading that said only "rows
     * built from data" left a reader matching a paragraph about position-matching against seven
     * reports none of which is about it.
     */
    heading: (found) => {
      const kinds = new Set(found.map((issue) => issue.via));
      const built = kinds.size === 1 ? ` built by \`${[...kinds][0]}\`` : " built from data";
      return `${found.length} row(s)${built} with no \`key\`:`;
    },
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.via === "map"
        ? `    <${issue.tag}> comes from a \`map\`, so without a key these rows are matched by position.`
        : `    <${issue.tag}> comes from a \`list\`, so its identity is inferred rather than chosen.`,
    ],
    advice:
      "Give each row a `key` from your data — an id. Not the array index, which IS the position and\n" +
      "so says nothing a position did not already say.\n\n" +
      "A finding names which of the two it found, and they fail differently.\n\n" +
      "`map` has no identity without a key at all: rows are matched by position, so inserting or\n" +
      "removing anywhere but the end hands every row below it the previous row's state and DOM.\n\n" +
      "`list` infers one from what makes a row different from its siblings, and a key you write\n" +
      "wins over it. The inference can fail — a row whose every field is nested or shared with its\n" +
      "siblings has nothing to be told apart by — and it matters most in the commonest case of all:\n" +
      "data that arrives fresh, where every object is new and no reference is left to recognise.\n\n",
  },

  read(element, { has, resolve }) {
    if (has("key")) return [];

    // `row-callback.ts` carries the walk and the note on what it can and cannot reach. A callback
    // lifted into a `const` is the same callback, and this rule was silent on every one of them.
    const built = rowCallbackFor(element, resolve);
    if (built === undefined) return [];

    /**
     * The tag as WRITTEN, host or component alike — unlike every other rule in this family, which
     * asks about markup and so ignores a component. A row is usually `<Row item={…} />`, and a key
     * on a component is exactly as meaningful as one on a `<tr>`: it is what the diff matches on,
     * and the component is what holds the state that goes to the wrong row without it.
     */
    const tag = openingOf(element).tagName.getText();
    return [{ tag, via: built.via, ...positionOf(openingOf(element)) }];
  },
} as const satisfies ElementRule<RowWithoutAKeyIssue>;
