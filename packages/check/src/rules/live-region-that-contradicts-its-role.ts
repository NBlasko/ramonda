import { positionOf } from "../syntax";
import type { ElementContext, HostElementRule } from "./rule";

/**
 * An `aria-live` that undoes the urgency the role was chosen for.
 *
 * `role="alert"` and `role="status"` are live regions with a politeness built in: an alert is
 * `assertive` and interrupts whatever the reader is being told, a status is `polite` and waits for a
 * gap. An explicit `aria-live` beside either **replaces** that, and the two are the only values it
 * can take — so writing one is always either redundant or a reversal.
 *
 * ## Both directions cost something, and they cost different things
 *
 * **An alert made polite** waits. A validation error, a failed save, a session about to expire —
 * announced when the reader happens to pause, which on a form being filled in may be minutes later
 * or never. The author picked `alert` precisely because the message could not wait, and then made
 * it wait.
 *
 * **A status made assertive** interrupts. "Saved", "3 results", a progress figure — cutting across
 * whatever the reader was in the middle of, every time it changes. A screen reader user filling in
 * a form with a live result count set to `assertive` is interrupted on every keystroke, and the
 * usual outcome is that they turn the page's announcements off entirely, which takes the real
 * messages with them.
 *
 * ## Why this is a fault rather than a preference
 *
 * The role already says which one is wanted. Nobody writes `role="alert" aria-live="polite"`
 * meaning both — it arrives when `aria-live` is added "to be safe" beside a role that already had
 * it, or when a shared component takes a politeness prop that the alert case forgot to override.
 * Either way the source says two things and the reader hears one.
 *
 * Redundant agreement — `role="alert" aria-live="assertive"` — is not reported. Saying one thing
 * twice is untidy, and this package reports faults rather than habits.
 */
export interface LiveRegionThatContradictsItsRoleIssue {
  /** `alert` or `status`. */
  role: string;
  /** The politeness the role brings. */
  brings: string;
  /** The politeness written beside it. */
  written: string;
  file: string;
  line: number;
  column: number;
}

/** The two roles that ARE live regions, and the politeness each one carries. */
const BRINGS: ReadonlyMap<string, string> = new Map([
  ["alert", "assertive"],
  ["status", "polite"],
  // `log` and `timer` are live regions too, and both are `polite`. They are far rarer and behave the
  // same way, so they are here for completeness rather than because anybody has been caught by them.
  ["log", "polite"],
  ["timer", "polite"],
]);

export const liveRegionThatContradictsItsRole = {
  id: "live-region-that-contradicts-its-role",

  report: {
    severity: "warn",
    reportedWhen: "an `aria-live` replaces the politeness the element's role already carries",
    heading: (found) => `${found.length} live region(s) whose urgency was undone:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    \`role="${issue.role}"\` is \`${issue.brings}\`, and \`aria-live="${issue.written}"\` replaces that — ${
        issue.written === "polite" ? "the message waits" : "the message interrupts"
      }, and ${issue.written === "polite" ? "may never be heard" : "keeps interrupting"}.`,
    ],
    advice:
      '`role="alert"` and `role="status"` are live regions with a politeness built in: an alert\n' +
      "interrupts, a status waits for a gap. An explicit `aria-live` replaces that, and there are\n" +
      "only two values it can take — so writing one is either redundant or a reversal.\n\n" +
      "An alert made POLITE waits. A validation error, a failed save, a session about to expire —\n" +
      "announced when the reader happens to pause, which on a form being filled in may be minutes\n" +
      "later or never.\n\n" +
      "A status made ASSERTIVE interrupts. A live result count cutting across every keystroke, and\n" +
      "the usual outcome is that the reader turns the page's announcements off entirely — which\n" +
      "takes the real messages with them.\n\n" +
      "Delete the `aria-live`. The role already says which one was wanted, and it cannot disagree\n" +
      "with itself:\n\n" +
      "```tsx\n" +
      '<div role="alert">{error}</div>\n' +
      '<div role="status">{count} results</div>\n' +
      "```\n\n" +
      "If the politeness genuinely has to move, drop the role and keep `aria-live` alone — one\n" +
      "source for it rather than two.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * A `@Host` props bag configures a real element, and a live region written there behaves the same.
   *
   * Both halves take the order guard: a spread after either may replace it, and then the two this
   * reports as disagreeing are not the two that render.
   */
  alsoOnHost: true,
  evenWhenSpreading: true,

  read(_element, { attr, overwritable, at }: ElementContext) {
    const role = attr("role")?.trim().toLowerCase();
    if (role === undefined) return [];
    // A chain is a list of alternatives, and which one the browser takes is not asked here.
    if (role.includes(" ")) return [];

    const brings = BRINGS.get(role);
    if (brings === undefined) return [];

    const written = attr("aria-live")?.trim().toLowerCase();
    if (written === undefined) return [];
    // Agreement is untidy, not a fault. `off` is a third thing entirely — it says the region is not
    // live at all, which is a stronger claim than a politeness and belongs to whoever wrote it.
    if (written === brings || written === "off") return [];
    if (written !== "polite" && written !== "assertive") return [];
    if (overwritable("role") || overwritable("aria-live")) return [];

    return [{ role, brings, written, ...positionOf(at) }];
  },
} as const satisfies HostElementRule<LiveRegionThatContradictsItsRoleIssue>;
