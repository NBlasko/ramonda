/** `declaration-does-nothing`: a declaration the rest of the block makes inert. */

import { KEYWORDS } from "../keywords.generated";
import { flatten } from "../flatten";
import { GLOBAL, type Block, withoutImportant } from "./shared";
import { type Finding } from "./index";

/**
 * A declaration another declaration on the SAME element switches off.
 *
 * **The one question ordinary CSS cannot ask.** A stylesheet does not know which rules reach an
 * element, so nothing there can say *this line does nothing*. A block is one element's rule, so
 * here it is answerable — and what it reports is a broken LAYOUT rather than broken CSS: the
 * property exists, the value is valid, the build is green, and the browser ignores it.
 *
 * **It is not visible through `getComputedStyle` either**, which is why no test anybody would write
 * catches these. Measured in Chromium: the browser reports `z-index: 10` on a static element and
 * `width: 300px` on an inline one, having done neither. Computed is not used.
 *
 * ## Every list here was MEASURED, and that is not a formality
 *
 * Each property was asked of Chromium beside the neighbour that should disable it and beside one
 * that should not. **Four of seventeen candidates act on a block container** — `align-content`,
 * `justify-items`, `place-items`, `place-content`, which modern engines apply to block layout — so
 * a list written from memory would have shipped four false reports. They are not in the table.
 *
 * The same measurement fixed the `display` test: `flex`, `inline-flex`, `grid`, `inline-grid` and
 * the two-value `block flex` / `inline grid` all use `gap`; `block`, `inline`, `inline-block`,
 * `table`, `table-cell`, `list-item`, `flow-root` and `ruby` do not. A word test for `flex` or
 * `grid` is exactly that boundary.
 *
 * ## Absence proves nothing, so absence is silent
 *
 * `flatten` drops a spread — `...$(base)` merges declarations this never sees. So a row may only
 * read a disabling declaration that is PRESENT. `top: 20px` on its own says nothing, because the
 * block spread above it may be what positions the element, and a rule that guessed would report
 * correct CSS. The same reasoning keeps `text-overflow` quiet when no `white-space` is written:
 * that property is INHERITED, so an absent one may be `nowrap` from an ancestor.
 *
 * ## And a nested rule is a group of its own
 *
 * `&:hover` is the same element, so a base `display` really does decide a `gap` written under it —
 * but `& > span` is a different element and the same reading would be wrong about that. One reading
 * has to serve both, so the narrow one does: a declaration is decided only by its own group.
 * Silence costs a report; the alternative costs a false one.
 */
interface Inert {
  /** The properties this row can report. */
  readonly subjects: readonly string[];
  /** Which values of the subject are at risk. Every value, when this is absent. */
  readonly when?: (value: string) => boolean;
  /** Every property whose value this row reads. One missing from the group means SILENCE. */
  readonly reads: readonly string[];
  /** A property whose mere presence keeps the subject alive, whatever `reads` says. */
  readonly rescuedBy?: readonly string[];
  /** Given what it reads, is the subject switched off? */
  readonly off: (seen: ReadonlyMap<string, string>) => boolean;
  /** The sentence, given the subject and what was read. */
  readonly says: (subject: string, seen: ReadonlyMap<string, string>) => string;
}

/**
 * A `display` whose element arranges its own children, so the box properties mean something on it.
 *
 * Three words rather than two: `-webkit-box` and `-webkit-inline-box` lay out children and use
 * `gap`, measured in Chromium, so a test for `flex` or `grid` alone would report both on correct
 * CSS.
 *
 * Covered by this: `flex`, `inline-flex`, `grid`, `inline-grid`, the two-value `block flex` and
 * `inline grid`, every `-webkit-` spelling of those, and `-ms-flexbox` / `-ms-grid` — which measure
 * as inert in Chromium and are left alone anyway, because silence is the safe direction.
 *
 * No display CSS has that is not one of these carries any of the three words.
 */
const LAYS_OUT_CHILDREN = (display: string): boolean => /\b(flex|grid|box)\b/.test(display);

/**
 * A `display` CSS actually has — because a row that fires when the value is NOT something must not
 * fire on a word nobody has finished typing.
 *
 * `display: bolck` is a typo, and the author may be about to write `flex`, which makes the `gap`
 * beside it exactly right. Reporting it is speaking about a declaration somebody is still fixing —
 * the reading `unknown-property` already gives way to elsewhere in this file.
 *
 * Only this row needs it, and the asymmetry is why: `position: static` and `overflow: visible` fire
 * when the value IS something, so a misspelling is not that value and they go quiet on their own.
 *
 * A vendor spelling needs no exception: no generated row holds `-webkit-box`, so it fails this —
 * and every vendor display CSS has carries `box`, `flex` or `grid` anyway, so the row is quiet
 * about it either way.
 */
const A_REAL_DISPLAY = (display: string): boolean => {
  const known = KEYWORDS.display;
  if (known === undefined) return true;
  const words = new Set(known.split(" "));
  // The canonical text has its spaces collapsed already; the shared strip is for one rule, not speed.
  return withoutImportant(display)
    .split(/\s+/)
    .filter((one) => one !== "")
    .every((one) => words.has(one) || GLOBAL.has(one));
};

/**
 * A size a browser can use without laying anything out, which is what makes `aspect-ratio` inert.
 *
 * Measured: beside `width: 140px`, a `height` of `50%`, `calc(50% - 2px)`, `min-content`,
 * `max-content`, `fit-content`, `stretch` or `inherit` all leave `aspect-ratio` doing its job,
 * because none of them is a size until something else has been laid out.
 *
 * So a plain dimension or a zero, and nothing else. `calc(60px - 2px)` is definite too and is left
 * out: it costs a report nobody was going to write, and the alternative is arithmetic in a rule.
 */
const DEFINITE =
  /^(0|[+-]?(\d+\.?\d*|\.\d+)(px|rem|em|ch|ex|cap|ic|lh|rlh|cm|mm|q|in|pt|pc|vw|vh|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|vb|vi))$/i;

/** A value nothing here can reason about: a keyword that resolves elsewhere, or a variable. */
const OPAQUE = (value: string): boolean => GLOBAL.has(value) || value.includes("var(");

/** `display: none` and `contents` make everything inert; that is not the fault this reports. */
const NO_BOX = new Set(["none", "contents"]);

/** Values of `white-space` that let a line wrap, so nothing ever overflows one. */
const WRAPS = new Set(["normal", "pre-wrap", "pre-line", "break-spaces"]);

const INERT: readonly Inert[] = [
  {
    // Measured on Chromium beside `display: block` and beside the display each one uses.
    subjects: [
      "gap",
      "row-gap",
      "column-gap",
      "justify-content",
      "align-items",
      "flex-direction",
      "flex-wrap",
      "flex-flow",
      "grid-template-columns",
      "grid-template-rows",
      "grid-auto-flow",
      "grid-auto-columns",
      "grid-auto-rows",
    ],
    reads: ["display"],
    // Measured: a multi-column block uses `gap`, so any of these makes the pair correct CSS.
    rescuedBy: ["columns", "column-count", "column-width"],
    off: (seen) => {
      const display = seen.get("display") ?? "";
      return A_REAL_DISPLAY(display) && !LAYS_OUT_CHILDREN(display) && !NO_BOX.has(display);
    },
    says: (subject, seen) =>
      `\`${subject}\` does nothing here: \`display: ${seen.get("display")}\` lays out no children of ` +
      `its own, so there is nothing for it to arrange.\n\n        Write \`display: flex\` or ` +
      `\`display: grid\`, or take the declaration out.`,
  },
  {
    subjects: [
      "top",
      "right",
      "bottom",
      "left",
      "inset",
      "inset-block",
      "inset-inline",
      "inset-block-start",
      "inset-block-end",
      "inset-inline-start",
      "inset-inline-end",
    ],
    reads: ["position"],
    off: (seen) => seen.get("position") === "static",
    says: (subject) =>
      `\`${subject}\` does nothing here: \`position: static\` is the one position an offset does ` +
      `not move.\n\n        Write \`position: relative\`, or take the declaration out.`,
  },
  {
    subjects: ["float"],
    reads: ["position"],
    off: (seen) => seen.get("position") === "absolute" || seen.get("position") === "fixed",
    says: (subject, seen) =>
      `\`${subject}\` does nothing here: \`position: ${seen.get("position")}\` takes the element out ` +
      `of the flow, and a float has no flow left to sit in.`,
  },
  {
    subjects: ["resize"],
    when: (value) => value !== "none",
    reads: ["overflow"],
    // A longhand written beside the shorthand is what the element really has, and it brings `resize`
    // back — measured: `overflow: visible; overflow-x: auto` resizes.
    rescuedBy: ["overflow-x", "overflow-y"],
    off: (seen) => seen.get("overflow") === "visible",
    says: (subject) =>
      `\`${subject}\` does nothing here: \`overflow: visible\` leaves the element nothing to scroll, ` +
      `and only a scroll container can be resized.\n\n        Write \`overflow: auto\`, or take the ` +
      `declaration out.`,
  },
  {
    subjects: ["text-overflow"],
    when: (value) => value !== "clip",
    reads: ["white-space"],
    off: (seen) => WRAPS.has(seen.get("white-space") ?? ""),
    says: (subject, seen) =>
      `\`${subject}\` does nothing here: \`white-space: ${seen.get("white-space")}\` lets the text ` +
      `wrap, so no line ever overflows for it to mark.\n\n        Write \`white-space: nowrap\`, or ` +
      `take the declaration out.`,
  },
  {
    subjects: ["text-overflow"],
    when: (value) => value !== "clip",
    reads: ["overflow"],
    // As above: `overflow: visible; overflow-x: hidden` draws the ellipsis.
    rescuedBy: ["overflow-x", "overflow-y"],
    off: (seen) => seen.get("overflow") === "visible",
    says: (subject) =>
      `\`${subject}\` does nothing here: \`overflow: visible\` lets the text spill out instead of ` +
      `being cut, so there is nothing to mark.\n\n        Write \`overflow: hidden\`, or take the ` +
      `declaration out.`,
  },
  {
    subjects: ["aspect-ratio"],
    when: (value) => value !== "auto",
    reads: ["width", "height"],
    off: (seen) => DEFINITE.test(seen.get("width") ?? "") && DEFINITE.test(seen.get("height") ?? ""),
    says: (subject) =>
      `\`${subject}\` does nothing here: \`width\` and \`height\` are both set, so the box already ` +
      `has both of its sizes.\n\n        Set one of them to \`auto\`, or take the declaration out.`,
  },
];

/** What one group holds about one property: its winning value, where it was written, and its holes. */
interface Written {
  readonly value: string;
  readonly at?: number;
  readonly holes: number;
}

/**
 * Every property `declaration-does-nothing` can report, for the page that lists them.
 *
 * Nothing sees a page that is merely wrong, so this is what `doesNothingPage.test.ts` compares it against —
 * the page and the table otherwise drift the first time a row is narrowed.
 */
export const INERT_SUBJECTS: readonly string[] = [...new Set(INERT.flatMap((one) => one.subjects))];

export function doesNothing(block: Block, findings: Finding[]): void {
  /** One group per element-and-context: the declarations a browser applies together. */
  const groups = new Map<string, Map<string, Written>>();
  for (const one of flatten(block)) {
    const key = `${one.selector} @ ${one.conditions.join("|")}`;
    let group = groups.get(key);
    if (group === undefined) groups.set(key, (group = new Map()));
    // The later of two wins, which is what the browser applies and so what this must read.
    group.set(one.property, {
      value: one.canonical.slice(one.property.length + 1, -1).trim(),
      at: one.at,
      holes: one.holes.length,
    });
  }

  for (const group of groups.values()) {
    /**
     * One declaration, one finding — `text-overflow` has two rows and a block can fail both:
     * written with `white-space: normal` AND `overflow: visible` it would be reported twice on the
     * same line. The first row to fire is the one that speaks.
     */
    const reported = new Set<string>();
    for (const row of INERT) {
      for (const subject of row.subjects) {
        if (reported.has(subject)) continue;
        const written = group.get(subject);
        if (written === undefined || written.at === undefined) continue;
        if (written.holes > 0) continue;
        if (row.when !== undefined && !row.when(written.value)) continue;
        if (row.rescuedBy?.some((one) => group.has(one)) === true) continue;

        const seen = new Map<string, string>();
        let readable = true;
        for (const name of row.reads) {
          const found = group.get(name);
          // Absent, holding a hole, or a keyword that resolves elsewhere — all unanswerable.
          if (found === undefined || found.holes > 0 || OPAQUE(found.value)) readable = false;
          else seen.set(name, found.value);
        }
        if (!readable) continue;
        if (!row.off(seen)) continue;

        reported.add(subject);
        findings.push({
          rule: "declaration-does-nothing",
          at: written.at,
          length: subject.length,
          message: row.says(subject, seen),
        });
      }
    }
  }
}
