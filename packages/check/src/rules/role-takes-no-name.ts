import { positionOf } from "../syntax";
import { NAME_PROHIBITED, NAME_PROHIBITED_TAGS, ROLES } from "./aria";
import { openingOf } from "./element";
import type { ElementRule } from "./rule";

/**
 * A name written on something that cannot be named.
 *
 * `aria-label` is not a tooltip and not a comment: it is the ACCESSIBLE NAME of a thing in the
 * accessibility tree, and the specification says which roles may have one. A `<div>` has the
 * `generic` role, which is the role for an element that carries no meaning at all, and naming
 * prohibited is the whole point of it — an element with no meaning has nothing for a name to name.
 * `role="presentation"` is stronger still: it takes the element out of the tree entirely.
 *
 * So `<div aria-label="Filters">` does not label a region. It does nothing. The attribute is in the
 * DOM, it is visible in the inspector, and a screen reader announces the children exactly as it
 * would have without it.
 *
 * **This is the common shape of the mistake, not an exotic one.** The intent is almost always a
 * landmark or a group, and the fix is almost always one word: give the element the role it was
 * meant to have, or use the element that already has it.
 */
export interface RoleTakesNoNameIssue {
  /** The attribute that does nothing — `aria-label` or `aria-labelledby`. */
  attribute: string;
  /** The tag it was written on. */
  tag: string;
  /** The role that forbids it: written, or the tag's own. */
  role: string;
  /** Whether that role was written on the element or comes from the tag itself. */
  from: "role" | "tag";
  file: string;
  line: number;
  column: number;
}

/** The two ways an author gives something a name. `aria-label` first: it is the commoner by far. */
const NAMES = ["aria-label", "aria-labelledby"];

/**
 * A name on a role that has none.
 *
 * A WARNING, which is this repository's rule for a new rule. Nothing in this repository trips it —
 * measured across every app and package.
 *
 * **A written `role` always wins.** `<div role="region" aria-label="Filters">` is correct and
 * common — the div is no longer generic. So the tag's own role is only consulted when nothing was
 * written, and a role this cannot read silences the element entirely.
 */
export const roleTakesNoName = {
  id: "role-takes-no-name",

  report: {
    severity: "warn",
    reportedWhen: "an `aria-label` or `aria-labelledby` is written on a role the specification forbids naming",
    heading: (found) => `${found.length} name(s) on something that cannot be named:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} ${issue.attribute}=…> — ${
        issue.from === "role" ? `\`role="${issue.role}"\`` : `a <${issue.tag}> is \`${issue.role}\`, and that`
      } takes no name, so this does nothing.`,
    ],
    advice:
      "An `aria-label` is the accessible NAME of something in the accessibility tree, and the\n" +
      "specification says which roles may have one. A `<div>` is `generic` — the role for an element\n" +
      'that carries no meaning — so there is nothing for a name to name, and `role="presentation"`\n' +
      "is stronger still: it removes the element from the tree altogether.\n\n" +
      "The attribute is still in the DOM and still visible in the inspector. A screen reader\n" +
      "announces the children exactly as it would have without it.\n\n" +
      "The intent is almost always a landmark or a group, so the fix is usually one word: give the\n" +
      "element the role it was meant to have — `region`, `group`, `navigation` — or write the\n" +
      'element that already has it. `<section aria-label="Filters">` is a named region and is\n' +
      'correct; `<nav aria-label="Breadcrumb">` is how two navs are told apart.\n\n' +
      "A written `role` always wins over the tag's own, so an element you have given a real role is\n" +
      "never reported.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * Reported past a spread, from the side a spread cannot reach over.
   *
   * Two attributes decide this — the `role` and the name written beside it — and a spread after
   * either one can replace or remove it, measured through `renderToString`. The naming attribute
   * is asked about its own position in the loop below; the `role` is asked here.
   */
  evenWhenSpreading: true,

  read(element, { tag, attr, has, overwritable, spreads }) {
    // Markup only: what `<Panel aria-label="x" />` does with the prop is decided inside it.
    if (tag === undefined) return [];
    if (overwritable("role") && has("role")) return [];

    const written = attr("role")?.trim().toLowerCase();
    let role: string;
    let from: "role" | "tag";

    if (written !== undefined) {
      // A chain takes the first role the browser understands, and that is the one that decides.
      const first = written.split(/\s+/).find((name) => ROLES.has(name));
      // Nothing recognisable in it: the unknown-role rule has that, and this one says nothing.
      if (first === undefined) return [];
      role = first;
      from = "role";
    } else if (has("role")) {
      // A `role` this cannot read may be anything, including one that takes a name.
      return [];
    } else {
      const own = NAME_PROHIBITED_TAGS.get(tag);
      if (own === undefined) return [];
      /**
       * The role is the TAG's own, and a spread — on either side — may be carrying a `role` that
       * overrides it with one that does take a name.
       *
       * The `role` branch above needs no such question: it is written down, and only what comes
       * after it can reach it. Here there is nothing written to come after.
       */
      if (spreads) return [];
      role = own;
      from = "tag";
    }

    if (from === "role" && !NAME_PROHIBITED.has(role)) return [];

    const found: RoleTakesNoNameIssue[] = [];
    for (const attribute of openingOf(element).attributes.properties) {
      if (!("name" in attribute) || attribute.name === undefined) continue;
      /**
       * Lowercased, because the DOM lowercases it.
       *
       * This was written case-SENSITIVELY first, on the sibling rule's claim that
       * `aria-labelledBy` reaches the DOM as a different attribute. Measured through
       * `renderToString`, that is false for an HTML element: attributes go through
       * `setAttribute`, which the HTML specification lowercases, so `aria-labelledBy` arrives as
       * `aria-labelledby` and IS a name. Skipping it would have been a silence on a real fault.
       *
       * It is true inside SVG, where `setAttributeNS(null, name)` writes the name verbatim — but
       * every tag in `NAME_PROHIBITED_TAGS` is an HTML tag, so that case cannot arrive here.
       */
      const name = attribute.name.getText().toLowerCase();
      if (!NAMES.includes(name)) continue;
      // A spread after this one may take the name away, and then there is nothing to report.
      if (overwritable(name)) continue;
      found.push({ attribute: name, tag, role, from, ...positionOf(attribute) });
    }
    return found;
  },
} as const satisfies ElementRule<RoleTakesNoNameIssue>;
