import { positionOf } from "../syntax";
import { openingOf } from "./element";
import type { ElementRule } from "./rule";

/**
 * `class` written where Ramonda reads `className`.
 *
 * The one place this JSX deliberately differs from HTML, and it differs because it has to: `class`
 * is a reserved word in the object literal a JSX factory receives. So Ramonda reads `className`,
 * and a `class` attribute is passed through to the element as an attribute nobody claims — the
 * styling it names never applies.
 *
 * It is worth a rule rather than a shrug because of how it fails: the element renders, the class
 * string is right there in the DOM inspector, and the only symptom is that nothing is styled. A
 * reader looking at the source sees correct-looking markup and goes hunting in the stylesheet.
 *
 * The framework reports it at runtime as `RMD039` — but only for markup that renders. This is the
 * same fault found in a branch nobody has opened.
 */
export interface ClassInsteadOfClassNameIssue {
  /** The tag it was written on. */
  tag: string;
  file: string;
  line: number;
  column: number;
}

export const classInsteadOfClassName = {
  id: "class-instead-of-classname",

  report: {
    severity: "warn",
    reportedWhen: "an element carries `class` where `className` was meant, so it styles nothing",
    alsoReportedAs: "RMD039",
    heading: (found) => `${found.length} element(s) with \`class\` where \`className\` was meant:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} class=…> — Ramonda reads \`className\`, so this styles nothing.`,
    ],
    advice:
      "Rename it to `className`. This is the one place the JSX deliberately differs from HTML, and\n" +
      "it has to: `class` is a reserved word in the object literal a JSX factory receives.\n\n" +
      "What makes it worth reporting is how it fails. The element renders, the class string is\n" +
      "visible in the DOM, and the only symptom is that nothing is styled — so the hunt starts in\n" +
      "the stylesheet, which is the one place the fault is not.\n\n" +
      "A COMPONENT is not reported: `<Panel class=…>` is a prop that component defined, and what it\n" +
      "does with it is its own business.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag, has }) {
    // Host elements only. On a component, `class` is a prop somebody declared.
    if (tag === undefined) return [];
    if (!has("class")) return [];
    return [{ tag, ...positionOf(openingOf(element)) }];
  },
} as const satisfies ElementRule<ClassInsteadOfClassNameIssue>;
