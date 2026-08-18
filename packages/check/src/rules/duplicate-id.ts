import { positionOf } from "../syntax";
import type { TreeRule } from "./rule";

/**
 * Two elements in one render carrying the same `id`.
 *
 * An id is the one thing in a document that is promised to be unique, and a surprising amount is
 * built on that promise. `getElementById` and `querySelector("#x")` answer with the FIRST one and
 * never mention the second. `<label for="x">` labels the first, so the other input has no label at
 * all — in the accessibility tree, not merely visually. `aria-labelledby` and `aria-describedby`
 * resolve to the first. A fragment link scrolls to the first. And `document.activeElement`,
 * focus management and any test written against the id all pick the same one.
 *
 * None of that fails loudly. The second element simply becomes unreachable by the name it was
 * given, which is why this is worth a rule: the page renders, nothing throws, and one control is
 * quietly nameless.
 */
export interface DuplicateIdIssue {
  /** The id both elements claim. */
  id: string;
  /** The tag of the element reported — the second one. */
  tag: string;
  /** The line holding the first element, which is the one everything will resolve to. */
  firstAtLine: number;
  file: string;
  line: number;
  column: number;
}

/**
 * Two elements in one render with the same literal `id`.
 *
 * A WARNING, which is this repository's rule for a new rule. Nothing in this repository trips it —
 * measured across every app and package.
 *
 * **Only elements that are always present**, which the family computes. `{editing ? <input id="x"/>
 * : <span id="x"/>}` is two ids in the source and one in the document, and reporting it would be
 * reporting correct markup.
 */
export const duplicateId = {
  id: "duplicate-id",

  report: {
    severity: "warn",
    reportedWhen: "two elements in one render carry the same literal `id`, and both are always present",
    heading: (found) => `${found.length} element(s) claiming an \`id\` another element already has:`,
    // The same-line wording is not decoration. Written only as "line N", a duplicate written
    // `<input id="a" /><input id="a" />` printed "line 4 already claims it" from line 4 — the
    // reader is sent to the line they are already looking at, twice. Read from the output.
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} id="${issue.id}"> — ${
        issue.firstAtLine === issue.line ? "an earlier element on this line" : `line ${issue.firstAtLine}`
      } already claims it,`,
      `    and everything that looks the id up will find that one.`,
    ],
    advice:
      "An id is the one name a document promises is unique, and more is built on that promise than\n" +
      "it looks: `getElementById` and `#x` answer with the first and never mention the second, a\n" +
      "`<label for>` labels the first — so the other control is nameless in the accessibility tree,\n" +
      "not just visually — and `aria-labelledby`, `aria-describedby` and a fragment link all resolve\n" +
      "the same way.\n\n" +
      "Nothing fails while this happens. The page renders and the second element is simply\n" +
      "unreachable by the name it was given.\n\n" +
      "If the two are the same control in two states, give them one element. If they are two\n" +
      "controls, give them two ids — and if the markup repeats, build the id from the row's own\n" +
      "identity rather than writing it in.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read({ elements }) {
    const found: DuplicateIdIssue[] = [];
    /** The first element to claim each id — the one everything will resolve to. */
    const claimed = new Map<string, number>();

    for (const node of elements) {
      // A spread may carry an `id`, and nothing static can say what it is.
      if (node.spreads || !node.alwaysPresent) continue;
      const id = node.attr("id");
      if (id === undefined) continue;

      const where = positionOf(node.element);
      const first = claimed.get(id);
      if (first === undefined) {
        claimed.set(id, where.line);
        continue;
      }
      found.push({ id, tag: node.tag ?? "element", firstAtLine: first, ...where });
    }

    return found;
  },
} as const satisfies TreeRule<DuplicateIdIssue>;
