/**
 * Which ROLES each `aria-*` attribute belongs to — the attribute-centric half of ARIA's tables.
 *
 * The specification documents this twice: each role lists the states it supports, and each state
 * lists the roles it is used in and inherits into. **This is deliberately the second one.**
 *
 * Reading it role-first means getting INHERITANCE right for every role in ARIA — `checkbox` from
 * `input` from `widget` — and a superclass property missed anywhere is a report against correct
 * markup, which is the one thing this package cannot afford. Reading it attribute-first, the
 * inheritance is already flattened into one list per attribute, and each list is short enough to
 * check by eye against the specification.
 *
 * ## Partial ON PURPOSE, and the direction of every doubt
 *
 * Only attributes whose role set is small, famous and stable are here. `aria-orientation`,
 * `aria-readonly`, `aria-required` and `aria-activedescendant` are not, because their sets are long
 * and their inheritance is fiddly, and being wrong about one of those means reporting markup that
 * works.
 *
 * The same rule decides every doubt WITHIN a list: when it is not certain whether a role belongs,
 * it goes IN. An extra role costs a missed report; a missing one costs a false report, and those
 * two are not the same price.
 *
 * An attribute that is not here at all is never judged.
 */
export const ARIA_BELONGS_TO: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["aria-checked", new Set(["checkbox", "menuitemcheckbox", "menuitemradio", "option", "radio", "switch", "treeitem"])],
  ["aria-selected", new Set(["columnheader", "gridcell", "option", "row", "rowheader", "tab", "treeitem"])],
  ["aria-pressed", new Set(["button"])],
  ["aria-level", new Set(["comment", "heading", "listitem", "row", "treeitem"])],
  [
    "aria-posinset",
    new Set([
      "article",
      "comment",
      "listitem",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "option",
      "radio",
      "row",
      "tab",
      "treeitem",
    ]),
  ],
  [
    "aria-setsize",
    new Set([
      "article",
      "comment",
      "listitem",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "option",
      "radio",
      "row",
      "tab",
      "treeitem",
    ]),
  ],
  // The range roles, which are the whole of the `aria-value*` family.
  ["aria-valuenow", new Set(["meter", "progressbar", "scrollbar", "separator", "slider", "spinbutton"])],
  ["aria-valuemin", new Set(["meter", "progressbar", "scrollbar", "separator", "slider", "spinbutton"])],
  ["aria-valuemax", new Set(["meter", "progressbar", "scrollbar", "separator", "slider", "spinbutton"])],
  ["aria-valuetext", new Set(["meter", "progressbar", "scrollbar", "separator", "slider", "spinbutton"])],
  ["aria-sort", new Set(["columnheader", "rowheader"])],
  ["aria-modal", new Set(["alertdialog", "dialog"])],
  ["aria-multiline", new Set(["searchbox", "textbox"])],
  ["aria-multiselectable", new Set(["grid", "listbox", "tablist", "tree", "treegrid"])],
  ["aria-placeholder", new Set(["searchbox", "textbox"])],
  ["aria-autocomplete", new Set(["combobox", "searchbox", "textbox"])],
  // The table family. `cell` and `row` are where these live; the header roles inherit them.
  ["aria-colcount", new Set(["grid", "table", "treegrid"])],
  ["aria-rowcount", new Set(["grid", "table", "treegrid"])],
  ["aria-colindex", new Set(["cell", "columnheader", "gridcell", "row", "rowheader"])],
  ["aria-rowindex", new Set(["cell", "columnheader", "gridcell", "row", "rowheader"])],
  ["aria-colspan", new Set(["cell", "columnheader", "gridcell", "rowheader"])],
  ["aria-rowspan", new Set(["cell", "columnheader", "gridcell", "rowheader"])],
]);

/**
 * The roles a reader is most likely to have MEANT, said in the report.
 *
 * Naming one or two beats naming eleven: the point of the sentence is to make the fix obvious, and
 * a list long enough to skim is a list nobody reads. Taken from the front of each set, which is
 * where the commonly written roles sit.
 */
export function whereItBelongs(attribute: string): string | undefined {
  const roles = ARIA_BELONGS_TO.get(attribute);
  if (roles === undefined) return undefined;
  const named = [...roles].slice(0, 3);
  return roles.size > named.length ? `${named.join("`, `")}\` and others` : named.join("`, `");
}
