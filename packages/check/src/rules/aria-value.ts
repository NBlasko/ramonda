import { positionOf } from "../syntax";
import { ARIA_VALUES, type AriaValue } from "./aria";
import type { HostElementRule } from "./rule";

/**
 * An `aria-*` attribute carrying a value its specification does not allow.
 *
 * The attribute is spelled right, so the sibling rule about unknown names has nothing to say, and
 * the browser keeps it because an attribute is just a string. What does not happen is any of the
 * meaning: `aria-hidden="yes"` is not `true`, so the element stays in the accessibility tree; a
 * `aria-live="loud"` region announces nothing; `aria-level="two"` gives a heading no level at all.
 *
 * The failure is silent in the way that matters most — the page looks right, the attribute is
 * visibly there in the inspector, and only a screen reader disagrees.
 *
 * **`false` is a value, not an absence.** `aria-hidden="false"` is the documented way to say an
 * element is exposed, and this rule never has anything to say about it.
 */
export interface AriaValueIssue {
  /** The attribute — `aria-hidden`. */
  attribute: string;
  /** What was written. */
  value: string;
  /** What is permitted, worded for the kind of value it takes. */
  wants: string;
  file: string;
  line: number;
  column: number;
}

const BOOLEAN = new Set(["true", "false"]);
const BOOLEAN_OR_UNDEFINED = new Set(["true", "false", "undefined"]);
const TRISTATE = new Set(["true", "false", "mixed", "undefined"]);

/** Whether a value is permitted, and what to say when it is not. */
function judge(spec: AriaValue, value: string): string | undefined {
  switch (spec.kind) {
    case "boolean":
      return BOOLEAN.has(value) ? undefined : "`true` or `false`";
    case "boolean-or-undefined":
      return BOOLEAN_OR_UNDEFINED.has(value) ? undefined : "`true`, `false` or `undefined`";
    case "tristate":
      return TRISTATE.has(value) ? undefined : "`true`, `false`, `mixed` or `undefined`";
    case "integer":
      return /^-?\d+$/.test(value) ? undefined : "a whole number";
    case "number":
      // The forms a browser's own number parser takes, and no more: this rejects a value, so
      // anything it is unsure about has to pass.
      return /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(value) ? undefined : "a number";
    case "token": {
      const tokens = spec.tokens;
      if (tokens === undefined || tokens.has(value)) return undefined;
      // "one of", because the bare list read as `it takes \`assertive\`, \`off\`, \`polite\`` —
      // which is what the printed report said before anybody read it.
      return `one of ${[...tokens]
        .sort()
        .map((token) => `\`${token}\``)
        .join(", ")}`;
    }
  }
}

/**
 * An `aria-*` value the specification does not permit.
 *
 * A WARNING, which is this repository's rule for a new rule. Nothing in this repository trips it —
 * measured across every app and package.
 *
 * **Only a literal is judged.** `aria-hidden={hidden}` is an expression, and the honest answer to
 * what it holds is that this cannot know — the element context returns `undefined` for it and this
 * rule says nothing. Neither does it judge an attribute with no entry in {@link ARIA_VALUES}: a
 * label takes any string, an id reference is any non-empty name, and a table that guessed at those
 * would report correct markup.
 */
export const ariaValue = {
  id: "aria-value",

  report: {
    severity: "warn",
    reportedWhen: "an `aria-*` attribute carries a literal value its specification does not permit",
    heading: (found) => `${found.length} \`aria-*\` value(s) the specification does not allow:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    ${issue.attribute}="${issue.value}" — it takes ${issue.wants}.`,
    ],
    advice:
      "The name is right, so nothing complains: the browser keeps any attribute you write, and the\n" +
      'value is visible in the inspector. What does not happen is the meaning. `aria-hidden="yes"`\n' +
      'is not `true`, so the element stays in the accessibility tree; `aria-live="loud"` announces\n' +
      'nothing; `aria-level="two"` gives a heading no level at all.\n\n' +
      '`false` is a value and never reported — `aria-hidden="false"` is the documented way to say\n' +
      "an element is exposed, which is not the same as leaving the attribute off.\n\n" +
      "Only literals are judged. An attribute whose value is an expression is left alone, and so is\n" +
      "one whose type is a label or an id reference, where any string is well formed.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * Reported past a spread, from the side a spread cannot reach over.
   *
   * A rule about what the attribute SAYS — `aria-valuenow="lots"` where a number is wanted — so a
   * later spread that replaces or removes it makes the report untrue, and each attribute is asked
   * about its own position rather than the element's.
   */
  evenWhenSpreading: true,

  alsoOnHost: true,

  read(_element, { tag, attr, overwritable, attributes }) {
    // Markup only. `<Panel aria-hidden="yes" />` is a prop on a component, and what that component
    // does with it is decided inside it — where this rule meets the real attribute again.
    if (tag === undefined) return [];

    const found: AriaValueIssue[] = [];
    for (const attribute of attributes) {
      const name = attribute.name.toLowerCase();
      const spec = ARIA_VALUES.get(name);
      if (spec === undefined) continue;

      const value = attr(name);
      if (value === undefined) continue;
      // A spread written after it may replace this value with any other, or with nothing at all.
      if (overwritable(name)) continue;

      const wants = judge(spec, value.trim());
      if (wants !== undefined) {
        found.push({ attribute: name, value, wants, ...positionOf(attribute.at) });
      }
    }
    return found;
  },
} as const satisfies HostElementRule<AriaValueIssue>;
