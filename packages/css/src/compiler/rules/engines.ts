/** Rules about what the browsers' engines do differently with the same declaration. */

import { propertyName } from "../normalise";
import { RESETS_DIFFER } from "../leaves.generated";
import { standardFormOf } from "../flatten";
import { GRAMMAR_SHAPES } from "../grammarShapes.generated";
import { type Block, type BlockItem } from "./shared";
import { type Finding } from "./index";

/**
 * A shorthand this project switched off — `margin: 8px` under `"*": { shorthand: false }`.
 *
 * The message names the longhands, because that is the whole of the fix and the project chose this
 * setting to be asked for them.
 */
/**
 * A shorthand the engines RESET differently — see `RESETS_DIFFER`, measured by
 * `build-shorthand-leaves.mjs`.
 *
 * `-webkit-mask` is the case: Chromium and Firefox reset `mask-clip`, `mask-composite` and
 * `mask-mode`, and WebKit keeps them. The author's own line renders two ways before anything here
 * touches it, and no split can write one page for all three — so it is refused, the way a value
 * CSS would drop is. The standard property is named where there is one, and here there is: every
 * engine has `mask`.
 */
export function resetsDifferAcrossEngines(block: Block, findings: Finding[]): void {
  const walkItems = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      if (item.kind === "rule") {
        walkItems(item.items);
        continue;
      }
      const property = propertyName(item.property);
      const kept = RESETS_DIFFER[property];
      if (kept === undefined) continue;

      const standard = standardFormOf(property);
      const instead =
        standard !== undefined && RESETS_DIFFER[standard] === undefined
          ? `Write \`${standard}\`, or set the longhands yourself.`
          : "Set the longhands yourself.";
      findings.push({
        rule: "resets-differ-across-engines",
        at: item.at ?? 0,
        length: item.property.length,
        message:
          `\`${property}\` resets ${kept.map((one) => `\`${one}\``).join(", ")} in some browsers and not in ` +
          `others, so this line renders differently in each. ${instead}`,
      });
    }
  };
  walkItems(block.items);
}

/**
 * A VALUE the engines read differently — `contested` on a grammar shape, which the generator
 * measures. `animation: auto` is `animation-name: auto` in Firefox and touches nothing in Chromium
 * or WebKit, so the author's line renders two ways. It is refused, as a shorthand the engines reset
 * differently is: a value this package cannot make render one way is not an option.
 */
export function valueDiffersAcrossEngines(block: Block, findings: Finding[]): void {
  const walkItems = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      if (item.kind === "rule") {
        walkItems(item.items);
        continue;
      }
      const property = propertyName(item.property);
      const contested = GRAMMAR_SHAPES[property]?.contested;
      if (contested === undefined) continue;
      for (const part of item.value) {
        if (part.kind !== "text" || part.at === undefined) continue;
        // The WORD's own position — not the first place its letters appear, inside `autoslide`.
        let word: string | undefined;
        let at = 0;
        for (const one of part.text.split(/([\s,]+)/)) {
          // In any case: the splitter lower-cases before it refuses, so the rule must too.
          if (contested.includes(one.toLowerCase())) {
            word = one;
            break;
          }
          at += one.length;
        }
        if (word === undefined) continue;
        findings.push({
          rule: "value-differs-across-engines",
          at: part.at + at,
          length: word.length,
          message:
            `\`${word}\` in \`${property}\` is read differently by different browsers, so this line renders ` +
            `differently in each. Set the longhand you mean yourself.`,
        });
        break;
      }
    }
  };
  walkItems(block.items);
}
