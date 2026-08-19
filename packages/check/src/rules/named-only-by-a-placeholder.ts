import { LABELS_A_CONTROL, NAMES_ITSELF } from "./idTable";
import type { ProjectRule } from "./rule";

/**
 * A control whose only name is its `placeholder`.
 *
 * The name computation really does fall back to `placeholder`, so this control is not nameless —
 * which is why it is a report of its own rather than a case of `control-with-no-label`. Being
 * precise about that matters: told they have "no label" for a field with a placeholder in it,
 * somebody reasonably concludes the checker is wrong and stops reading its output.
 *
 * What is wrong is subtler and worse than nameless. **The name disappears the moment somebody
 * types.** The field explains itself only while it is empty, so:
 *
 * - Anybody who is interrupted mid-form comes back to boxes with text in them and nothing saying
 *   what any of them is.
 * - Anybody reviewing what they typed before submitting has the same problem.
 * - Autofill fills several fields at once and every explanation vanishes together.
 * - The text is placeholder-styled — low contrast by convention, in every browser's default.
 *
 * None of that is visible while the form is being written, because it is written empty.
 *
 * ## What it will not say
 *
 * A control with any real name beside the placeholder: a `<label>`, an `aria-label`, an
 * `aria-labelledby`, a `title`. A placeholder BESIDE a label is a hint, which is what it is for,
 * and is not reported.
 */
export interface NamedOnlyByAPlaceholderIssue {
  /** `input`, `select` or `textarea`. */
  tag: string;
  /** An `input`'s type, when it says one. */
  type: string | undefined;
  file: string;
  line: number;
  column: number;
}

export const namedOnlyByAPlaceholder = {
  id: "named-only-by-a-placeholder",

  report: {
    severity: "warn",
    reportedWhen: "a form control's only name is its `placeholder`, which disappears as soon as anybody types",
    heading: (found) => `${found.length} form control(s) named only by a placeholder:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag}${issue.type === undefined ? "" : ` type="${issue.type}"`}> is explained only while ` +
        `it is empty — the placeholder goes when the first character arrives.`,
    ],
    advice:
      'A placeholder IS a name, which is why this is not the "no label" report — but it is a name\n' +
      "that only exists while the field is empty. The moment somebody types, the one thing saying\n" +
      "what the field is for is gone.\n\n" +
      "Nobody sees that while writing the form, because a form is written empty. It shows up for\n" +
      "the person interrupted halfway through, the person checking their answers before submitting,\n" +
      "and anybody whose autofill has just filled six boxes and cleared six explanations at once.\n" +
      "Placeholder text is also low-contrast by every browser's default.\n\n" +
      "Give the control a real name and keep the placeholder for what it is good at — an example of\n" +
      'the format. `<label htmlFor={id}>Email</label>` with `placeholder="you@example.com"` says\n' +
      "both things, and neither one disappears.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(project) {
    const labelled = new Set(
      project.references
        .filter((reference) => LABELS_A_CONTROL.has(reference.attribute))
        .map((reference) => reference.target),
    );

    return project.controls
      .filter((control) => {
        if (!control.placeholder) return false;
        if (control.namingAttribute || control.insideALabel || control.opaqueId) return false;
        if (control.tag === "input" && control.type !== undefined && NAMES_ITSELF.has(control.type)) return false;
        return control.id === undefined || !labelled.has(control.id);
      })
      .map(({ tag, type, file, line, column }) => ({ tag, type, file, line, column }));
  },
} as const satisfies ProjectRule<NamedOnlyByAPlaceholderIssue>;
