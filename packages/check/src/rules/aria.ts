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
