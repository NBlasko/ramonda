import { LABELS_A_CONTROL, NAMES_ITSELF } from "./idTable";
import type { FormControl, ProjectRule } from "./rule";

/**
 * A form control with no accessible name — nothing anywhere says what it is for.
 *
 * Every other element on a page can be worked out from what is in it. A control cannot: an
 * `<input>` is an empty box, and the only thing that says whether it wants an email address or a
 * postcode is its label. Without one a screen reader announces "edit, blank" and stops. Voice
 * control has nothing to say the name of. And the visible text sitting beside it, which looks like
 * a label to anybody using a mouse, is just text — it is not attached to anything.
 *
 * The visible half is what makes this survive review: the form looks completely normal.
 *
 * ## Why it belongs to the project subject
 *
 * Because one of the four ways to name a control is `<label htmlFor="email">` and the control is
 * `<input id="email">`, and those two are frequently not in the same render — a label component
 * here, a field component there. The id table is what pairs them, and it is why this rule waited
 * for that subject to exist.
 *
 * The other three ways are local and read from the element itself: an `aria-label`, an
 * `aria-labelledby`, a `title`, or a `<label>` wrapped around it.
 *
 * ## What it will not say
 *
 * **A control whose own `id` this cannot read.** It cannot be matched against any label, so
 * nothing about that control is knowable — a narrower silence than the family's, and the right one:
 * the rest of the project is still perfectly answerable.
 *
 * **A `placeholder` is deliberately not counted as a label, and deliberately not reported either.**
 * The name computation really does fall back to it, so calling such a control unnamed would be
 * wrong. Calling it well named would also be wrong — a placeholder disappears the moment somebody
 * types, taking the only description of the field with it. That is a different report with a
 * different sentence, and it is not this one.
 *
 * **`submit`, `reset` and `button` inputs**, which are named by their `value` and by a browser
 * default when there is none. **`hidden`**, which is not rendered. **`image`**, which is named by
 * its `alt` and belongs to `unnamed-image`.
 *
 * ## The residual risk, stated rather than hidden
 *
 * `<label><SomeField /></label>` names the control inside `SomeField` at runtime, and nothing in
 * `SomeField`'s own source shows it. A control written that way, with no id and no naming
 * attribute, is reported although it works. It is an uncommon shape — wrapping a COMPONENT in a
 * label and relying on it is fragile, and a component meant to be labelled almost always takes the
 * label as a prop — but it is real, and it is the one way this rule can be wrong.
 */
export interface ControlWithNoLabelIssue {
  /** `input`, `select` or `textarea`. */
  tag: string;
  /** An `input`'s type, when it says one — `<input type="email">` reads better in a report. */
  type: string | undefined;
  file: string;
  line: number;
  column: number;
}

/** Whether anything the walk saw could be giving this control a name. */
function couldBeNamed(control: FormControl, labelled: ReadonlySet<string>): boolean {
  if (control.namingAttribute || control.insideALabel) return true;
  /**
   * A `placeholder` is a name, and a bad one — so this rule must not claim there is none.
   *
   * The first version reported six controls across this repository and every one of them was
   * placeholder-only, which is exactly the case the docstring above already said would not be
   * reported. The docstring was right and the code did not do it. `named-only-by-a-placeholder`
   * makes the accurate claim about these instead.
   */
  if (control.placeholder) return true;
  if (control.tag === "input" && control.type !== undefined && NAMES_ITSELF.has(control.type)) return true;
  // Its own id is unreadable, so it cannot be matched against any label — and nothing about this
  // one control is knowable. Not a project-wide silence: everything else still is.
  if (control.opaqueId) return true;
  return control.id !== undefined && labelled.has(control.id);
}

export const controlWithNoLabel = {
  id: "control-with-no-label",

  report: {
    severity: "warn",
    reportedWhen:
      "a form control has no label, no `aria-label`, no `aria-labelledby` and no `title`, so nothing says what it is for",
    heading: (found) => `${found.length} form control(s) with nothing to say what they are for:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag}${issue.type === undefined ? "" : ` type="${issue.type}"`}> has no label — ` +
        `a screen reader announces it as "edit, blank" and stops.`,
    ],
    advice:
      "Every other element can be worked out from what is inside it. A control cannot: an input is\n" +
      "an empty box, and the only thing saying whether it wants an email address or a postcode is\n" +
      "its label. Any text sitting beside it looks like a label to somebody using a mouse and is\n" +
      "attached to nothing.\n\n" +
      "Four ways to fix it, in the order worth reaching for. A `<label htmlFor={id}>` beside the\n" +
      "control, which also makes clicking the words focus the field. A `<label>` wrapped around\n" +
      "both. An `aria-labelledby` naming text already on the page. Or `aria-label` where there is\n" +
      "genuinely nothing visible to point at — a search box whose only marking is an icon.\n\n" +
      "A `placeholder` is not a label and is not counted as one: it disappears the moment somebody\n" +
      "types, taking the only description of the field with it.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(project) {
    /** The ids some `<label for=…>` names, anywhere in the project. */
    const labelled = new Set(
      project.references
        .filter((reference) => LABELS_A_CONTROL.has(reference.attribute))
        .map((reference) => reference.target),
    );

    return project.controls
      .filter((control) => !couldBeNamed(control, labelled))
      .map(({ tag, type, file, line, column }) => ({ tag, type, file, line, column }));
  },
} as const satisfies ProjectRule<ControlWithNoLabelIssue>;
