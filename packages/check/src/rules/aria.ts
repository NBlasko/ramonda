/**
 * The WAI-ARIA vocabulary, as data.
 *
 * Source: **Accessible Rich Internet Applications (WAI-ARIA) 1.2**, W3C Recommendation, plus the
 * 1.3 role additions already in use. The element table at the bottom comes from *ARIA in HTML*,
 * which is the specification that maps the two vocabularies onto each other.
 *
 * ## Which way these tables are allowed to be wrong
 *
 * Every rule that reads them reports a name that is NOT in them, so a table that is short by one
 * reports correct markup — a false positive, and the one kind of mistake this package treats as
 * fatal to its own usefulness. A table that is long by one misses a typo, which is a fault going
 * unreported and no worse than the day before the rule existed.
 *
 * So where the spec is moving, these lean LONG. `mark`, `suggestion` and `comment` are ARIA 1.3 and
 * are listed; the deprecated `aria-dropeffect` and `aria-grabbed` are listed too, because code that
 * still carries one is old rather than wrong, and a checker is not the place to argue about that.
 */

/**
 * Every `aria-*` state and property.
 *
 * The commonest fault this catches is not an invented name — it is a CASE one. HTML attributes are
 * lowercase and JSX preserves what you type, so `aria-labelledBy` reaches the DOM as a different
 * attribute from `aria-labelledby` and does nothing at all, silently.
 */
export const ARIA_ATTRIBUTES: ReadonlySet<string> = new Set([
  "aria-activedescendant",
  "aria-atomic",
  "aria-autocomplete",
  "aria-braillelabel",
  "aria-brailleroledescription",
  "aria-busy",
  "aria-checked",
  "aria-colcount",
  "aria-colindex",
  "aria-colindextext",
  "aria-colspan",
  "aria-controls",
  "aria-current",
  "aria-describedby",
  "aria-description",
  "aria-details",
  "aria-disabled",
  "aria-dropeffect",
  "aria-errormessage",
  "aria-expanded",
  "aria-flowto",
  "aria-grabbed",
  "aria-haspopup",
  "aria-hidden",
  "aria-invalid",
  "aria-keyshortcuts",
  "aria-label",
  "aria-labelledby",
  "aria-level",
  "aria-live",
  "aria-modal",
  "aria-multiline",
  "aria-multiselectable",
  "aria-orientation",
  "aria-owns",
  "aria-placeholder",
  "aria-posinset",
  "aria-pressed",
  "aria-readonly",
  "aria-relevant",
  "aria-required",
  "aria-roledescription",
  "aria-rowcount",
  "aria-rowindex",
  "aria-rowindextext",
  "aria-rowspan",
  "aria-selected",
  "aria-setsize",
  "aria-sort",
  "aria-valuemax",
  "aria-valuemin",
  "aria-valuenow",
  "aria-valuetext",
]);

/**
 * Every role that may be written in markup.
 *
 * `none` and `presentation` are here and mean the same thing — the spec keeps both, and code uses
 * both.
 */
export const ROLES: ReadonlySet<string> = new Set([
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "comment",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "mark",
  "marquee",
  "math",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "meter",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "suggestion",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
]);

/**
 * The ABSTRACT roles, which exist to organise the vocabulary and must never appear in markup.
 *
 * The spec says so in as many words: they are "not permitted in content". They are worth their own
 * table rather than simply being left out of {@link ROLES}, because the advice differs — an unknown
 * role is probably a typo, and an abstract one is somebody reading the spec's inheritance diagram
 * and taking a branch name for a leaf.
 */
export const ABSTRACT_ROLES: ReadonlySet<string> = new Set([
  "command",
  "composite",
  "input",
  "landmark",
  "range",
  "roletype",
  "section",
  "sectionhead",
  "select",
  "structure",
  "widget",
  "window",
]);

/**
 * Elements that take no `role` and no `aria-*` at all.
 *
 * Every one of these is either not rendered (`meta`, `script`, `style`, `title`, `template`) or is
 * the document itself (`html`, `head`). There is no accessibility tree node to describe, so an
 * attribute here does not do a little — it does nothing.
 *
 * Kept SHORT on purpose. The spec restricts more elements than this in subtler ways, and each of
 * those subtleties is a chance to report correct markup. These eleven are the unambiguous ones.
 */
export const NO_ARIA: ReadonlySet<string> = new Set([
  "base",
  "head",
  "html",
  "link",
  "meta",
  "noscript",
  "param",
  "script",
  "style",
  "template",
  "title",
]);

/**
 * What kind of value each `aria-*` attribute takes.
 *
 * Source: **WAI-ARIA 1.2**, the "Characteristics" table under each state and property, where every
 * one of them declares its value type. The types below are that list collapsed to the ones a
 * static reader can actually judge.
 *
 * ## The types this deliberately does NOT carry
 *
 * `ID reference` and `ID reference list` — `aria-labelledby`, `aria-controls`, `aria-owns` and the
 * rest. Any non-empty string is a well-formed id, so there is nothing to judge without the
 * document; whether the id EXISTS is a different question and a different rule.
 *
 * `string` is absent for the same reason from the other side: `aria-label` takes any string, so
 * every value is correct and a table entry would say nothing.
 *
 * ## Which way it is allowed to be wrong
 *
 * The same way the tables above are. A rule reading this reports a value that is NOT permitted, so
 * a token list short by one reports correct markup — the fatal kind of mistake. Short lists are
 * therefore left out entirely rather than guessed at: an attribute with no entry here is one no
 * rule will judge.
 */
export type AriaValueKind = "boolean" | "boolean-or-undefined" | "tristate" | "integer" | "number" | "token";

export interface AriaValue {
  kind: AriaValueKind;
  /** For `token`, every value the specification permits. Absent for every other kind. */
  tokens?: ReadonlySet<string>;
}

export const ARIA_VALUES: ReadonlyMap<string, AriaValue> = new Map<string, AriaValue>([
  // true/false.
  ["aria-atomic", { kind: "boolean" }],
  ["aria-busy", { kind: "boolean" }],
  ["aria-disabled", { kind: "boolean" }],
  ["aria-modal", { kind: "boolean" }],
  ["aria-multiline", { kind: "boolean" }],
  ["aria-multiselectable", { kind: "boolean" }],
  ["aria-readonly", { kind: "boolean" }],
  ["aria-required", { kind: "boolean" }],

  // true/false/undefined — where "undefined" is a value you may write, meaning "not applicable".
  ["aria-expanded", { kind: "boolean-or-undefined" }],
  ["aria-grabbed", { kind: "boolean-or-undefined" }],
  ["aria-hidden", { kind: "boolean-or-undefined" }],
  ["aria-selected", { kind: "boolean-or-undefined" }],

  // tristate: true/false/mixed/undefined.
  ["aria-checked", { kind: "tristate" }],
  ["aria-pressed", { kind: "tristate" }],

  // integer.
  ["aria-colcount", { kind: "integer" }],
  ["aria-colindex", { kind: "integer" }],
  ["aria-colspan", { kind: "integer" }],
  ["aria-level", { kind: "integer" }],
  ["aria-posinset", { kind: "integer" }],
  ["aria-rowcount", { kind: "integer" }],
  ["aria-rowindex", { kind: "integer" }],
  ["aria-rowspan", { kind: "integer" }],
  ["aria-setsize", { kind: "integer" }],

  // number — a decimal is permitted, and is the point of a slider.
  ["aria-valuemax", { kind: "number" }],
  ["aria-valuemin", { kind: "number" }],
  ["aria-valuenow", { kind: "number" }],

  // token: one of a closed list.
  ["aria-autocomplete", { kind: "token", tokens: new Set(["both", "inline", "list", "none"]) }],
  ["aria-current", { kind: "token", tokens: new Set(["date", "false", "location", "page", "step", "time", "true"]) }],
  ["aria-haspopup", { kind: "token", tokens: new Set(["dialog", "false", "grid", "listbox", "menu", "tree", "true"]) }],
  ["aria-invalid", { kind: "token", tokens: new Set(["false", "grammar", "spelling", "true"]) }],
  ["aria-live", { kind: "token", tokens: new Set(["assertive", "off", "polite"]) }],
  ["aria-orientation", { kind: "token", tokens: new Set(["horizontal", "undefined", "vertical"]) }],
  ["aria-sort", { kind: "token", tokens: new Set(["ascending", "descending", "none", "other"]) }],
]);

/**
 * What a role does not work without — ARIA's "required states and properties".
 *
 * Source: **WAI-ARIA 1.2**, the "Required States and Properties" line in each role's
 * characteristics table.
 *
 * ## This table leans the OTHER way from the ones above, and it has to
 *
 * Everything above is a vocabulary, and a rule reads it to report a name that is NOT in it — so a
 * short list reports correct markup and a long one misses a typo. Here the reading is inverted: a
 * rule reports an entry that IS in the table and missing from the element, so an entry that should
 * not be here reports correct markup directly.
 *
 * So this is deliberately SHORT. Every role whose requirement is conditional in the specification
 * is left out — `separator` needs `aria-valuenow` only when it is focusable, and nothing static can
 * say whether it is. So is every role whose requirement moved between 1.1 and 1.2, `option` and
 * `spinbutton` among them: a requirement people disagree about is not one to fail a build over.
 *
 * What is left is the set where a role without the attribute has no meaning at all — a checkbox
 * that cannot say whether it is checked, a heading with no level, a slider with no value.
 */
export const ROLE_REQUIRES: ReadonlyMap<string, readonly string[]> = new Map([
  // A checked-ness with nowhere to live: the role promises a state the element never carries.
  ["checkbox", ["aria-checked"]],
  ["radio", ["aria-checked"]],
  ["switch", ["aria-checked"]],
  ["menuitemcheckbox", ["aria-checked"]],
  ["menuitemradio", ["aria-checked"]],

  // A heading's level IS its place in the outline; without one there is no outline entry.
  ["heading", ["aria-level"]],

  // A value with no value.
  ["meter", ["aria-valuenow"]],
  ["slider", ["aria-valuenow"]],
  ["scrollbar", ["aria-controls", "aria-valuenow"]],

  // A combobox that cannot say whether it is open is a text field with a decoration.
  ["combobox", ["aria-expanded"]],
]);

/**
 * Elements whose own markup already supplies the state a role asks for.
 *
 * `<input type="checkbox" role="checkbox">` carries its checked-ness natively — the accessibility
 * tree reads the element's own state, and an `aria-checked` beside it would be a second copy to
 * keep in step. The role is redundant there rather than incomplete, which is a different thing and
 * not this rule's business.
 */
export const STATE_FROM_THE_ELEMENT: ReadonlySet<string> = new Set(["input", "meter", "progress", "select", "option"]);
