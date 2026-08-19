import { couldExist } from "./idTable";
import type { ProjectRule } from "./rule";

/**
 * An ARIA relationship, or a `htmlFor`, naming an id that no element in the project carries.
 *
 * These attributes do not describe an element — they POINT at one, by id, and the browser resolves
 * the pointer. When it resolves to nothing the attribute does not fall back to something sensible;
 * it does nothing at all, and nothing says so.
 *
 * What that costs depends on which one it was, and the report says which:
 *
 * - **`aria-labelledby`** is usually the element's ONLY name. Pointing at nothing leaves a dialog,
 *   a region or a group announced as its role and no more — "dialog", with no clue what it is for.
 * - **`htmlFor`** is what makes a label a label. Broken, the input has no accessible name, and
 *   clicking the label no longer focuses the field — which is the visible half, and the half a
 *   sighted tester might notice.
 * - **`aria-controls`** and **`aria-owns`** describe a relationship that then is not there.
 *
 * None of these throws, and none is visible on the page. This is the kind of fault that survives
 * every review because there is nothing to see.
 *
 * ## Where it goes quiet
 *
 * The whole family stops when the project writes an `id` this cannot read — an author building ids
 * at runtime has said that "defined nowhere" is not knowable here. An element that spreads is never
 * asked about its own references either. `ProjectContext.unreadable` carries both decisions and
 * the measurement behind them.
 */
export interface ReferenceToAnIdThatIsNotThereIssue {
  /** The attribute doing the pointing. */
  attribute: string;
  /** The id it points at. */
  target: string;
  /** The tag it was written on, so a report reads like the source. */
  tag: string;
  file: string;
  line: number;
  column: number;
}

/** What each attribute costs when it resolves to nothing — the sentence the report needs. */
const COSTS: Readonly<Record<string, string>> = {
  "aria-labelledby": "so the element has no accessible name at all",
  "aria-describedby": "so the description is never announced",
  "aria-controls": "so the relationship it claims is not there",
  "aria-owns": "so the relationship it claims is not there",
  "aria-activedescendant": "so nothing is ever the active option",
  "aria-details": "so the details are never reachable",
  "aria-errormessage": "so the error is never announced with the field",
  "aria-flowto": "so the reading order it asks for is not applied",
  htmlfor: "so the label names nothing, and clicking it focuses nothing",
};

export const referenceToAnIdThatIsNotThere = {
  id: "reference-to-an-id-that-is-not-there",

  report: {
    severity: "warn",
    reportedWhen: "an `aria-labelledby`, `htmlFor` or other id reference names an id no element in the project carries",
    heading: (found) => `${found.length} id reference(s) resolving to nothing:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} ${issue.attribute}="${issue.target}"> — nothing carries that id, ${
        COSTS[issue.attribute.toLowerCase()] ?? "so the attribute does nothing"
      }.`,
    ],
    advice:
      "These attributes do not describe an element — they POINT at one, by id. When the pointer\n" +
      "resolves to nothing the attribute does not fall back to anything; it does nothing at all,\n" +
      "silently, and the page looks exactly the same.\n\n" +
      "`aria-labelledby` is usually an element's only name, so a broken one leaves a dialog\n" +
      'announced as "dialog" and nothing more. A broken `htmlFor` leaves the input unnamed AND\n' +
      "stops the label focusing it, which is the one half somebody might notice.\n\n" +
      "Check the spelling against the element you meant, and remember that `aria-labelledby` takes\n" +
      "a LIST — every id in it has to resolve, and each is checked here on its own.\n\n" +
      "Where a name is a single string rather than a pointer at existing markup, `aria-label` says\n" +
      "it directly and cannot break this way.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(project) {
    if (project.unreadable.length > 0) return [];

    return project.references
      .filter((reference) => reference.attribute.toLowerCase() !== "href" && !couldExist(reference.target, project))
      .map(({ attribute, target, tag, file, line, column }) => ({ attribute, target, tag, file, line, column }));
  },
} as const satisfies ProjectRule<ReferenceToAnIdThatIsNotThereIssue>;
