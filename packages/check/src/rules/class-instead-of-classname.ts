import { positionOf } from "../syntax";
import { openingOf } from "./element";
import type { ElementRule } from "./rule";

/**
 * `class` written where Ramonda reads `className`.
 *
 * The one place this JSX deliberately differs from HTML, and it differs because it has to: `class`
 * is a reserved word in the object literal a JSX factory receives.
 *
 * ## What actually happens, because it is not what this rule used to say
 *
 * It said the attribute "is passed through to the element as an unknown attribute and the styling
 * it names never applies". Measured against the framework instead of reasoned about: `class` is
 * RENAMED to `className` before the vnode is built, and has been since the first commit. So
 * `<span class="muted">` is styled, and reporting it as broken was a report on working code.
 *
 * Two things the rename cannot save, and they are what this rule is for:
 *
 * - **`className` on the same element.** That one wins and the `class` is dropped without a word —
 *   the only case here that loses something, and the reason this is still worth a rule.
 * - **A component.** `<Panel class="muted" />` is renamed too, so the component receives
 *   `className`. A `class` prop it declared reads `undefined` on every render, for ever. This is
 *   the case the rule used to skip on purpose, with "what it does with it is its own business" —
 *   which was wrong twice over, because the component never receives it to do anything with.
 *
 * Otherwise the cost is that the source does not say what the element gets, which is worth a
 * warning and is not worth an error.
 *
 * The framework reports it at runtime as `RMD039` — but only for markup that renders. This is the
 * same fault found in a branch nobody has opened.
 */
export interface ClassInsteadOfClassNameIssue {
  /** The tag it was written on — a host element's name, or the component's. */
  tag: string;
  /** The tag names a component, so the rename lands on a prop rather than on an element. */
  onComponent: boolean;
  /** `className` is on the same element, so this `class` is dropped rather than renamed. */
  dropped: boolean;
  file: string;
  line: number;
  column: number;
}

export const classInsteadOfClassName = {
  id: "class-instead-of-classname",

  report: {
    severity: "warn",
    reportedWhen: "an element carries `class` where Ramonda reads `className`",
    alsoReportedAs: "RMD039",
    heading: (found) => `${found.length} element(s) with \`class\` where \`className\` was meant:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.dropped
        ? `    <${issue.tag} class=… className=…> — \`className\` wins, so this \`class\` is dropped.`
        : issue.onComponent
          ? `    <${issue.tag} class=…> — renamed to \`className\`, so a \`class\` prop <${issue.tag} /> declared reads \`undefined\`.`
          : `    <${issue.tag} class=…> — renamed to \`className\`, so the source does not say what the element gets.`,
    ],
    advice:
      "Rename it to `className`. This is the one place the JSX deliberately differs from HTML, and\n" +
      "it has to: `class` is a reserved word in the object literal a JSX factory receives.\n\n" +
      "The rename happens for you, so most of these are styled correctly and the page is fine. Two\n" +
      "are not. An element carrying `className` as well keeps that one and drops this `class`\n" +
      "silently. And a COMPONENT is renamed just the same — `<Panel class=…>` arrives as\n" +
      "`className`, so a `class` prop that component declared reads `undefined` on every render.\n\n" +
      "A warning rather than an error, and it stays one: the common case renders exactly what was\n" +
      "meant, and only the source is misleading.",
  },

  /**
   * `class` written on the tag is a mistake in the source, and a spread does not unmake it.
   *
   * This is a rule about what the author WROTE — they meant `className` and typed the HTML name —
   * so no order guard: a later spread carrying `undefined` can take the attribute off the DOM
   * (measured through `renderToString`) and the prop the author meant is still missing.
   */
  evenWhenSpreading: true,

  read(element, { tag, has }) {
    if (!has("class")) return [];

    // `tag` is undefined for a component, and the component's own name is what names the report:
    // the rename reaches it too, so the report is about a prop rather than about an attribute.
    const onComponent = tag === undefined;
    const name = tag ?? openingOf(element).tagName.getText();

    return [{ tag: name, onComponent, dropped: has("className"), ...positionOf(openingOf(element)) }];
  },
} as const satisfies ElementRule<ClassInsteadOfClassNameIssue>;
