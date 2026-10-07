/** Rules about which of two declarations wins: one written to override what wins anyway, a narrower after a wider. */

import {
  aliasKey,
  conflict,
  covers,
  exclusive,
  flatten,
  layerPathFor,
  onlyTheModeDecides,
  rivalsOf,
  segments,
  sheetRank,
  standardFormOf,
  widthSlot,
} from "../flatten";
import { type Block, type BlockItem } from "./shared";
import { type Finding } from "./index";
import { declarationOutOfPlace, propertyNotAName, repeated, ruleOutOfPlace, unknownProperty } from "./properties";
import { atRuleOutOfPlace, unknownFrame } from "./selectors";
import { holeInHead } from "./logic";
import { stringNotAllowed, unknownFlag, unknownUnit, unknownValue } from "./values";
import { runOn } from "./text";

/**
 * A declaration written to override an earlier one, which the stylesheet's order will not let win.
 *
 * **The stylesheet has ONE order and a block has another.** A rule is shared by every element that
 * names it, so the sheet cannot honour any block's order — it emits unconditional rules before
 * conditional ones and broader properties before the ones they cover, and that is what makes the
 * common shapes right. Inside a block, the author's order is what decides. The two agree almost
 * always, and where they do not the author's loses SILENTLY.
 *
 * Measured against plain CSS in Chromium, the same declarations in the same order:
 *
 * | written | plain CSS | ours |
 * |---|---|---|
 * | `@media { padding: 40px }` then `padding: 8px` | 8px | **40px** |
 * | `@media { padding: 40px }` then `padding-left: 8px` | left 8px | **left 40px** |
 * | `@media { &:hover { … } }` then a plain one | same | same — a selector adds specificity |
 * | two under the SAME condition | same | same — the rank does not separate them |
 *
 * The merge cannot answer it: two different keys are two classes, both land, and the sheet breaks
 * the tie. Reported rather than silently reordered, because the sheet's order is what makes every
 * other block right and a page nobody edited must not move.
 *
 * Only the SELECTOR has to match, because a selector adds specificity and that beats source order
 * on its own — measured, and it is why the rule would otherwise report correct CSS.
 */
/**
 * A narrower shorthand written after a wider one, in the same context, when both reach the sheet
 * WHOLE — `border: var(--x)` then `border-top: var(--y)`, or `font: caption` then `font-variant:
 * var(--v)`.
 *
 * Both are in the word layer `v`, and nothing puts the narrower one above: through the merge both
 * classes stay, since a narrower shorthand does not clear a wider one, and the stylesheet decides
 * by which file the build read first. Measured in all three engines: right in one load order and
 * wrong in the other. A longhand count cannot order them — it moves when CSS adds a longhand, and
 * two releases then disagree. So the shape is refused, the way `override-out-of-order` refuses two
 * conditions no single position can serve.
 *
 * Asked through `layerPathFor` itself, of the declarations as the sheet receives them — SPLIT — so
 * the rule and the sheet cannot disagree: a narrower shorthand that splits is pieces in `p`,
 * stronger than `v`, and is not the fault. Nor is the other order, which the merge settles by
 * clearing.
 */
export function narrowerAfterAWholeShorthand(block: Block, findings: Finding[]): void {
  const flat = segments(block, { split: true }).flatMap((one) => (one.kind === "declarations" ? one.items : []));
  const whole = (one: (typeof flat)[number]) => layerPathFor(one).at(-1) === "v";

  for (const [index, later] of flat.entries()) {
    if (!whole(later)) continue;

    for (const earlier of flat.slice(0, index)) {
      if (!whole(earlier)) continue;
      if (earlier.selector !== later.selector || earlier.conditions.join("|") !== later.conditions.join("|")) continue;
      if (!covers(earlier.property, later.property)) continue;
      // Of DIFFERENT importance they are in different layers — the important one under the mirrored
      // `i` — and that layer decides, as in CSS. Only two of the same importance share `v`.
      if ((earlier.important === true) !== (later.important === true)) continue;

      findings.push({
        rule: "narrower-after-a-whole-shorthand",
        at: later.at ?? 0,
        length: later.property.length,
        message:
          `\`${later.property}\` comes after \`${earlier.property}\`, and both reach the stylesheet whole, so no ` +
          `order keeps \`${later.property}\` winning on every page. Set its longhands instead.`,
      });
      break;
    }
  }
}

export function overrideOutOfOrder(block: Block, findings: Finding[]): void {
  const flat = flatten(block);
  // Each asked once per declaration rather than once per pair — a rank parses the conditions — and
  // only of the few that get that far.
  type Declaration = (typeof flat)[number];
  const ranks = new Map<Declaration, number>();
  const contexts = new Map<Declaration, string>();
  const rank = (one: Declaration): number => {
    let found = ranks.get(one);
    if (found === undefined) ranks.set(one, (found = sheetRank(one)));
    return found;
  };
  const context = (one: Declaration): string => {
    let found = contexts.get(one);
    if (found === undefined) contexts.set(one, (found = one.conditions.join("|")));
    return found;
  };
  /**
   * The declarations met so far, filed by selector and property, so a later one is compared only
   * with the earlier ones it can fight — see {@link rivalsOf}. Against every one before it, 4000
   * custom properties took 3.2 s and 16 000 took 57 s.
   */
  const met = new Map<string, Map<string, number[]>>();
  const file = (under: Map<string, number[]>, name: string, index: number) => {
    const list = under.get(name);
    if (list === undefined) under.set(name, [index]);
    else list.push(index);
  };

  for (const [index, later] of flat.entries()) {
    let under = met.get(later.selector);
    if (under === undefined) met.set(later.selector, (under = new Map()));
    const candidates: number[] = [];
    for (const name of rivalsOf(later.property)) for (const one of under.get(name) ?? []) candidates.push(one);
    file(under, later.property, index);
    const standard = standardFormOf(later.property);
    if (standard !== undefined) file(under, aliasKey(standard), index);

    for (const earlier of [...new Set(candidates)].sort((a, b) => a - b).map((one) => flat[one] as Declaration)) {
      // The same key is the same thing set twice, and the merge already keeps the later one.
      if (earlier.key === later.key) continue;
      if (!conflict(earlier.property, later.property)) continue;

      /**
       * The merge settles it, so the sheet never gets to. A later shorthand CLEARS its own
       * longhands, and the clear-list carries the context — so it reaches an earlier longhand under
       * the same conditions and no other. Measured: `padding-left: 40px; padding: 8px` is the same
       * as plain CSS, and reporting it would be reporting correct CSS.
       */
      const sameContext = context(earlier) === context(later);
      if (sameContext && covers(later.property, earlier.property)) continue;

      /**
       * A TIE, which the sheet settles by position — so by the order the build met the two files.
       *
       * The bands in `widthSlot` rank a breakpoint by its width and everything else by a small
       * table, and two conditions inside one band tie. Measured in Chromium through a real Vite
       * build, the same block each time:
       *
       *     @supports (display: grid) { color: red; } @supports (display: flex) { color: blue; }
       *
       *     alone in the file                          blue — what plain CSS says
       *     after a block with the same two, reversed  RED
       *     after a block naming only the flex query   RED
       *
       * Both queries hold in every browser that can read the sheet, so the page depended on what
       * another component wrote. There is no order to give them that is CSS's — one sheet, one
       * position, and the author's two blocks each want a different one — so the shape is refused.
       *
       * The bands settle this for breakpoints; inside a band nothing can. Conditions that EXCLUDE
       * each other still tie and still say nothing, because no element is ever matched by both —
       * which is a colour scheme, an orientation and a medium, and most of what anybody writes.
       */
      if (
        rank(later) === rank(earlier) &&
        context(later) !== context(earlier) &&
        !exclusive(earlier.conditions, later.conditions)
      ) {
        findings.push({
          rule: "override-out-of-order",
          at: later.at ?? 0,
          length: later.property.length,
          message:
            `\`${earlier.conditions.join(" ") || earlier.property}\` and \`${later.conditions.join(" ") || later.property}\` ` +
            `can both hold at once, and the stylesheet cannot be ordered for both — it has one ` +
            `position for each rule, and\n        whichever the build reads first would win. Put ` +
            `\`${later.property}\` under one condition, or combine them with \`and\`.`,
        });
        return;
      }

      if (rank(later) >= rank(earlier)) continue;

      /**
       * A LOGICAL property meeting a PHYSICAL one, which no order can settle.
       *
       * `margin-inline` is left and right in a horizontal writing mode and top and bottom in a
       * vertical one, so whether it covers `margin-left` is not known until the element is laid
       * out. Measured in Chromium, both modes: the sheet's broadest-first order is right in one and
       * wrong in the other, silently, and the wrong one is the mode almost every page is in.
       *
       * The other direction needs no message, because it needs no rule: `margin` sets all four
       * sides whatever the mode, so it clears `margin-inline` and the merge settles it above.
       */
      if (onlyTheModeDecides(earlier.property, later.property)) {
        findings.push({
          rule: "override-out-of-order",
          at: later.at ?? 0,
          length: later.property.length,
          message:
            `\`${later.property}\` is written to override \`${earlier.property}\` above it, and whether ` +
            `it does depends on \`writing-mode\` — a logical property names a side the layout picks, so ` +
            `a stylesheet cannot be ordered for both. Write the two in one system: \`${earlier.property}\` ` +
            `has a logical spelling, and \`${later.property}\` a physical one.`,
        });
        return;
      }

      const where = earlier.conditions.length > 0 ? earlier.conditions.join(" ") : `\`${earlier.property}\``;
      findings.push({
        rule: "override-out-of-order",
        at: later.at ?? 0,
        length: later.property.length,
        message:
          `\`${later.property}\` is written to override ${where} above it, and it will not — the ` +
          `stylesheet emits ${becauseOf(earlier, later)}, so the earlier one wins wherever both ` +
          `apply. Write it above, or put it under the same condition.`,
      });
      return;
    }
  }
}

/**
 * Why the sheet puts the earlier one last, in the reader's own terms.
 *
 * Three orders can be the reason, and naming the wrong one sends a reader looking at the wrong
 * thing. One is width: the sheet reads a breakpoint off its query, so a narrower rule is emitted
 * after a wider one whatever order they were written in — see `widthSlot`.
 */
function becauseOf(
  earlier: { property: string; conditions: readonly string[] },
  later: { property: string; conditions: readonly string[] },
): string {
  /**
   * An alias pair first, because the shorthand sentence below is true of most of these and not of
   * this one: neither name is a shorthand, and what decides is that they are ONE property to the
   * engine and the sheet has picked which spelling goes first.
   */
  if (standardFormOf(earlier.property) === later.property || standardFormOf(later.property) === earlier.property) {
    return "a vendor prefix before the standard property it is another name for";
  }
  if (earlier.conditions.length === 0) return "a shorthand before its own longhands";
  if (widthSlot(later.conditions) === widthSlot(earlier.conditions)) {
    return "the broadest property first";
  }
  if (later.conditions.length === 0) return "conditional rules after unconditional ones";
  return "the rule that applies to a wider viewport first";
}

/**
 * `body` is the at-rule whose body these items ARE, and it changes what an item may be:
 *
 * - `keyframes` — frames, each holding ordinary declarations. A declaration outside a frame is
 *   dropped by the browser, so it is reported here.
 * - anything else named — descriptors, which are declarations and nothing else. A nested rule is
 *   reported, and the property rules stand down: the descriptor vocabulary is the types'.
 */
export function walk(items: readonly BlockItem[], findings: Finding[], body?: string): void {
  /** What each property was last declared as, for `repeated-declaration`. Per rule, not per block. */
  const seen = new Map<string, string>();

  for (const item of items) {
    if (item.kind === "rule") {
      if (body !== undefined && body !== "keyframes") {
        ruleOutOfPlace(item, body, findings);
        continue;
      }
      if (body === "keyframes") unknownFrame(item, findings);
      else atRuleOutOfPlace(item, findings);
      holeInHead(item.prelude, item.at, body === "keyframes" ? "a frame" : "a selector", findings);
      // A nested rule has its own scope: `color` beside it and `color` inside it are two
      // declarations on two different elements, and neither repeats the other. A frame's contents
      // are ordinary declarations, which is why the name does not travel into it.
      walk(item.items, findings);
      continue;
    }

    if (body === "keyframes") {
      declarationOutOfPlace(item, findings);
      continue;
    }

    /**
     * A hole read into the PROPERTY, which is what a forgiving parse does with one written where a
     * custom property cannot go. `$(name): 24px` puts it in the name; a hole standing alone with no
     * colon after it puts the whole declaration there.
     */
    const named = findings.length;
    holeInHead(item.property, item.at, item.value.length === 0 ? "a declaration" : "a property name", findings);
    /**
     * A name that is not a name, which silences the near-miss search below it: one fault, one report,
     * and `font size` is not a typo of a property — it is two words where one belongs.
     *
     * Not asked at all when the name held a HOLE, which the line above has just reported. A hole
     * kept as text by the tolerant reading is an expression, and an expression has spaces in it —
     * so this would say *`{cond ? "display:flex" : ""}` is not a property name* underneath a
     * diagnostic that already said something truer.
     */
    if (findings.length === named && propertyNotAName(item, findings)) {
      unknownUnit(item, findings);
      repeated(item, seen, findings);
      continue;
    }
    // Against the right vocabulary: the properties in an ordinary block, that at-rule's descriptors
    // in a named one. The types report WHETHER a name exists either way; this is the suggestion,
    // which a quoted key never gets from them.
    unknownProperty(item, findings, body);
    /**
     * The run-on FIRST, and it silences the value check for the same declaration.
     *
     * A missing `;` makes the next declaration part of this one's value, so the words in it are words
     * this property does not accept — and both rules have something true to say about one mistake.
     * Measured on the shape a person writes: `gap: 8px` with no `;` above `padding: 4px 0;` came back
     * as BOTH *`gap` does not accept `padding`* and *`padding` is being read as part of `gap`'s
     * value*. The second is the one that says what to do.
     */
    const before = findings.length;
    runOn(item, findings);
    if (findings.length === before && body === undefined) unknownValue(item, findings);
    unknownFlag(item, findings);
    stringNotAllowed(item, findings);
    unknownUnit(item, findings);
    repeated(item, seen, findings);
  }
}
