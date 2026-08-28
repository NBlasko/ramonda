import { positionOf } from "../syntax";
import { AUTOFILL_MODIFIERS, AUTOFILL_SWITCHES, autofillFieldOf } from "./autofill";
import type { ElementContext, ElementRule } from "./rule";

/**
 * An `autocomplete` value nothing recognises, so autofill does nothing.
 *
 * A browser matches the value against the HTML specification's list of autofill field names and
 * against nothing else. A token that is not on it is not a near miss the browser corrects — the
 * whole value is ignored, and the field simply never fills. `autocomplete="fullname"` looks exactly
 * as deliberate as `autocomplete="name"` and does exactly nothing.
 *
 * ## Who this is for, because it is not only a convenience
 *
 * Autofill is the difference between a form somebody can complete and one they cannot. Filling an
 * address by hand costs a person with a motor impairment real effort and real errors; a person
 * using voice control may have no other way to enter a long string accurately; and anybody on a
 * phone is retyping a card number they have already given a browser once. It is also WCAG's
 * *Identify Input Purpose*, which asks for exactly this vocabulary and no other.
 *
 * And it fails in the quietest way an attribute can. The markup is valid, the attribute is in the
 * DOM, nothing is logged, and the only symptom is a form that does not fill — which reads as the
 * browser being unhelpful rather than as a typo in the source.
 *
 * ## What it reads, and the ordering it deliberately does not police
 *
 * The specification's grammar is an optional `section-*`, an optional `shipping`/`billing`, an
 * optional contact word, the FIELD NAME, and an optional trailing `webauthn`. This asks the part
 * that is unambiguous — **is there a field name at all** — and says nothing about the order of what
 * sits in front of it. Getting those ordering rules exactly right is a second question, and being
 * wrong about it would mean reporting a value that fills perfectly well.
 *
 * A value it cannot read — `autocomplete={which}` — is not judged, which is the silence contract.
 */
export interface AutocompleteThatFillsNothingIssue {
  /** The element it was written on. */
  tag: string;
  /** The whole value, as the reader will find it. */
  written: string;
  /** The token nothing recognises — the last one, which is where the field name belongs. */
  token: string;
  /** A group word written where the field name should be, which is the commonest near miss. */
  onlyAModifier: boolean;
  file: string;
  line: number;
  column: number;
}

/** The elements a browser fills. `autocomplete` anywhere else is a different rule's business. */
const FILLABLE: ReadonlySet<string> = new Set(["input", "select", "textarea"]);

export const autocompleteThatFillsNothing = {
  id: "autocomplete-that-fills-nothing",

  report: {
    severity: "warn",
    reportedWhen: "an `autocomplete` value names no autofill field, so the browser ignores it entirely",
    heading: (found) => `${found.length} \`autocomplete\` value(s) no browser recognises:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} autocomplete="${issue.written}"> — ${
        issue.onlyAModifier
          ? `\`${issue.token}\` says WHICH one, not which field, so no field is named`
          : `nothing recognises \`${issue.token}\``
      }, and the whole value is ignored.`,
    ],
    advice:
      "A browser matches this against the HTML specification's list of autofill field names and\n" +
      "against nothing else. A token that is not on it is not a near miss it corrects — the whole\n" +
      "value is dropped and the field never fills.\n\n" +
      "The names that trip people up: `name` (not `fullname`), `username` (not `user-name`),\n" +
      "`postal-code` (not `zip` or `zipcode`), `tel` (not `phone`), `cc-number` (not `card-number`),\n" +
      "`address-level2` for a city and `address-level1` for a state or county.\n\n" +
      "`shipping`, `billing`, `home`, `work`, `mobile`, `fax` and `pager` say WHICH address or\n" +
      "number and are not fields on their own — they go in FRONT of one, as in\n" +
      '`autocomplete="shipping street-address"`.\n\n' +
      "This matters most for the people who have the least room to absorb it: filling an address by\n" +
      "hand is real effort and real errors for somebody with a motor impairment, and voice control\n" +
      "may have no other way to enter a long string accurately.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * A `@Host` props bag configures a real element, and a value written there fills as little.
   *
   * The order guard is taken because this reads a VALUE: a spread after the attribute may replace
   * it with one that fills perfectly well.
   */
  evenWhenSpreading: true,

  read(_element, { tag, attr, overwritable, at }: ElementContext) {
    if (tag === undefined || !FILLABLE.has(tag)) return [];

    const written = attr("autocomplete");
    if (written === undefined || written.trim() === "") return [];
    if (overwritable("autocomplete")) return [];

    const read = autofillFieldOf(written);
    if (read === undefined || read.field !== undefined) return [];

    return [
      {
        tag,
        written,
        token: read.token,
        // `autocomplete="billing"` is the commonest near miss and deserves its own sentence: the
        // author named a group and no field, which reads as complete and is not.
        onlyAModifier: AUTOFILL_MODIFIERS.has(read.token) || AUTOFILL_SWITCHES.has(read.token),
        ...positionOf(at),
      },
    ];
  },
} as const satisfies ElementRule<AutocompleteThatFillsNothingIssue>;
