/** Rules the project's own `properties` in `ramonda.css.ts` switch on: hardcoded values, units, words, shorthands. */

import { KEYWORDS, PRIMITIVE, SHORTHANDS, UNIT_TYPE } from "../keywords.generated";
import { type PropertyRules } from "../../config/config";
import { NARROW, ruleFor, tokensOnlyKinds } from "../../config/codegen";
import { propertyName } from "../normalise";
import { wordSet } from "../wordSet";
import { SHAPES } from "../shapes.generated";
import { holdsVar, misplacedWord } from "../split";
import { GLOBAL, namedColour, type Block, declarationsIn } from "./shared";
import { type Finding } from "./index";
import { KNOWN_UNITS, topLevelValues, unitsIn } from "./values";
import { A_DIMENSION, A_NUMBER } from "./namedSites";

/** Every bare word the `<color>` grammar reaches, minus the one that is not a colour anybody wrote. */
export const COLOUR_WORDS = new Set(
  (KEYWORDS.color ?? "").split(" ").filter((one) => one !== "" && one !== "currentcolor"),
);

/** The functions that produce a colour — `rgb()`, `oklch()`, `color-mix()`. */
const COLOUR_CALL = /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\s*\(/i;

/** A hex colour, in every length CSS allows. */
const HEX = /#[0-9a-fA-F]{3,8}(?![\w-])/;

/**
 * A colour written as a literal where the project said colours come from variables only.
 *
 * **This is the half a type cannot do.** Sixty-three properties accept a colour; forty say so in
 * their grammar and the generated types refuse a literal there outright. The other twenty-three are
 * composite — `border-left: 4px solid red`, `background`, `box-shadow` — and their value is
 * `string | number` because a union narrow enough to refuse `red` would refuse `4px solid red` as
 * well. So the rule reads those, and only those: one mechanism per property, never two for one.
 *
 * `currentcolor` is not a colour somebody hardcoded, it is a reference to the inherited one, and
 * `var()` is the escape CSS itself provides. Neither is reported.
 */
export function literalNotAllowed(block: Block, rules: PropertyRules | undefined, findings: Finding[]): void {
  const kinds = tokensOnlyKinds(rules);
  if (kinds.length === 0) return;
  dimensionNotAllowed(block, rules, findings);
  if (!kinds.includes("color")) return;

  for (const item of declarationsIn(block)) {
    const property = propertyName(item.property);
    // A property whose grammar SAYS it takes a colour is the types' to refuse — see above.
    if (PRIMITIVE[property] === "color") continue;
    // One that does not accept a colour at all has nothing here to find.
    if (!wordSet(KEYWORDS[property] ?? "").has("rebeccapurple")) continue;
    /**
     * Exempted by its own name, which is the thing the top-level list could not express.
     *
     * Asked of the property rather than of the kind, because a composite property HAS no kind —
     * `border` is a width, a style and a colour at once, so `"<color>"` never reaches it and only
     * `border: { hardcoded: true }` can speak for it.
     */
    if ((rules?.[property as keyof PropertyRules] as { hardcoded?: boolean } | undefined)?.hardcoded === true) {
      continue;
    }

    for (const part of item.value) {
      if (part.kind !== "text" || part.at === undefined) continue;

      const found = HEX.exec(part.text) ?? COLOUR_CALL.exec(part.text) ?? namedColour(part.text);
      if (found === null) continue;

      findings.push({
        rule: "hardcoded-not-allowed",
        at: part.at + found.index,
        length: found[0].length,
        message:
          `\`${found[0].trim()}\` is a colour written out, and this project takes colours only from its ` +
          `own tokens.\n\n        Declare it in \`ramonda.css.ts\` and write \`$group.name\`, or set ` +
          `\`${JSON.stringify(property)}: { hardcoded: true }\` beside \`"<color>"\`.`,
      });
      break;
    }
  }
}

/**
 * A dimension or a number written out where the project said that kind comes from its variables.
 *
 * **The half the BUILD sees, and it saw nothing.** The types refused `padding-left: 8px` and the
 * rule said nothing, which read as a division of labour and was a hole: vite and esbuild run these
 * rules over a block and never type-check it, so a project could watch `ramonda-css check` refuse a
 * file and watch the dev server serve it. Measured, asking the rules alone:
 *
 *     padding-left: 8px       []                     compiled
 *     width: 200px            []                     compiled
 *     border: 1px solid red   [hardcoded-not-allowed]  only the composite was caught
 *
 * It also answers the message. `Narrowed<never, Token<…>>` names neither the project nor the config
 * file; this names both, and `inOrder` drops the compiler's word where this one has spoken — the
 * same answer `unknown-token` got.
 *
 * ## What is deliberately NOT a literal
 *
 * A CALL is an escape hatch and is not read into: `calc($space.md * 2)` holds a `2` that is not a
 * hardcoded length, and nothing here can tell it from one that is. A bare `0` needs no unit in CSS
 * and is not a value anybody reached for instead of a token. `var()` is what CSS itself provides. A
 * HOLE evaluates at render and is nobody's to read. A keyword is not a dimension at all.
 */
function dimensionNotAllowed(block: Block, rules: PropertyRules | undefined, findings: Finding[]): void {
  const kinds = tokensOnlyKinds(rules);

  for (const item of declarationsIn(block)) {
    const property = propertyName(item.property);

    /**
     * A CUSTOM PROPERTY has no kind, so only a value that can be nothing else is read.
     *
     * `--own: red; color: var(--own)` walked around the whole setting in one line — two
     * declarations this compiler reads and neither was looked at. But a custom property holds
     * anything: `--n: 3` is not a length and `--label: "red"` is text. So a bare number is left
     * alone and a quoted string never matches, because `topLevelValues` keeps the quotes.
     *
     * Reported against EVERY forbidden kind at once, since nothing here says which was meant.
     */
    if (property.startsWith("--")) {
      for (const value of topLevelValues(item.value)) {
        const text = value.text;
        if (text === undefined || value.at === undefined) continue;

        const unit = A_DIMENSION.exec(text)?.[2]?.toLowerCase();
        const family = unit === undefined ? undefined : UNIT_TYPE[unit];
        const dimension = family !== undefined && kinds.includes(family) ? family : undefined;
        const colour =
          kinds.includes("color") && (HEX.test(text) || COLOUR_CALL.test(text) || COLOUR_WORDS.has(text))
            ? "color"
            : undefined;
        const found = colour ?? dimension;
        if (found === undefined || Number(text) === 0) continue;

        findings.push({
          rule: "hardcoded-not-allowed",
          at: value.at,
          length: text.length,
          message:
            `\`${text}\` is ${NARROW[found]?.said ?? "a value"} written out, and this project takes ` +
            `them only from its own tokens.` +
            `\n\n        A custom property set here is still a value this project ships. Declare it in ` +
            `\n        \`ramonda.css.ts\` and write \`$group.name\`.`,
        });
        break;
      }
      continue;
    }

    const primitive = PRIMITIVE[property];
    // No kind, no answer: nothing can say what a composite property's pieces should have been.
    // A colour inside one is the colour walk's, which reads the value rather than the type.
    if (primitive === undefined) continue;
    const rule = ruleFor(rules, property);
    if (rule.hardcoded !== false) continue;

    for (const value of topLevelValues(item.value)) {
      const text = value.text;
      if (text === undefined || value.at === undefined) continue;

      /**
       * A colour LONGHAND is read here too, and was not.
       *
       * `literalNotAllowed` skipped a property whose grammar says `<color>` as *the types' to
       * refuse* — true of the checker and false of the BUILD, which runs no TypeScript. Forty
       * properties, `color: red` the first of them, compiled by vite and esbuild.
       */
      const isColour = primitive === "color" && (HEX.test(text) || COLOUR_CALL.test(text) || COLOUR_WORDS.has(text));
      if (!isColour && !A_DIMENSION.test(text) && !A_NUMBER.test(text)) continue;
      if (primitive === "color" && !isColour) continue;
      // A zero needs no unit in CSS and is not a value anybody wrote instead of reaching for one.
      if (Number(text) === 0) continue;

      findings.push({
        rule: "hardcoded-not-allowed",
        at: value.at,
        length: text.length,
        message:
          `\`${text}\` is ${NARROW[primitive]?.said ?? "a value"} written out, and this project takes ` +
          `them only from its own tokens.` +
          `\n\n        Declare it in \`ramonda.css.ts\` and write \`$group.name\`, or set ` +
          `\`${JSON.stringify(property)}: { hardcoded: true }\`.`,
      });
      break;
    }
  }
}

/**
 * The three settings the TYPES enforced and the BUILD did not — units, values, shorthand.
 *
 * Found by review pass 4, which swept every setting against every consumer. Vite and esbuild run
 * these rules over a block and never type-check it, so a setting that only reaches the types is a
 * setting the dev server ignores:
 *
 *     properties["*"].units         padding-left: 2rem    checker refuses, build serves
 *     properties["z-index"].values  z-index: 5            checker refuses, build serves
 *     properties["*"].shorthand     padding: 8px          checker refuses, build serves
 *
 * The project-wide `units`, `arity` and `variablesOnly` already spoke in both. So half the config
 * was enforced everywhere and half in one place, with nothing saying which half.
 *
 * `inOrder` drops the compiler's word on a line one of these reports, so an author still meets one
 * report rather than two — the same arrangement `variablesOnly` already has.
 */
export function unitNotAllowedPerProperty(block: Block, rules: PropertyRules | undefined, findings: Finding[]): void {
  if (rules === undefined) return;

  for (const item of declarationsIn(block)) {
    const property = propertyName(item.property);
    const allowed = ruleFor(rules, property).units;
    if (allowed === undefined) continue;

    const permitted = new Set(allowed.map((one) => one.toLowerCase()));
    for (const part of item.value) {
      if (part.kind !== "text" || part.at === undefined) continue;
      for (const found of unitsIn(part.text, part.at)) {
        const unit = found.unit.toLowerCase();
        // A unit CSS does not have is `unknown-unit`'s, which names it — two rules on one fault
        // reads as two faults. And a family this property said nothing about is not constrained.
        if (!KNOWN_UNITS.has(unit) || permitted.has(unit)) continue;
        if (![...permitted].some((one) => UNIT_TYPE[one] === UNIT_TYPE[unit])) continue;

        // Said once. The project-wide sweep runs first and may already have named this exact unit
        // at this exact position — see the note beside the call.
        if (findings.some((one) => one.rule === "unit-not-allowed" && one.at === found.at)) continue;

        findings.push({
          rule: "unit-not-allowed",
          at: found.at,
          length: found.length,
          message:
            `\`${found.unit}\` is a unit \`${property}\` does not take in this project. ` +
            `\`ramonda.css.ts\` allows ${[...permitted].sort().join(", ")}.`,
        });
      }
    }
  }
}

/**
 * A word one longhand of a shorthand has no place for, which makes the WHOLE declaration invalid.
 *
 * CSS drops a whole declaration when any part of it is invalid. `place-items: start space-between`
 * sets nothing in any browser — `justify-items` has no `space-between` — so the line the author
 * wrote does nothing, and nothing says so. Measured in Chromium, Firefox and WebKit.
 *
 * This is the reading half of a question the SPLITTER already asks: `misplacedWord` refuses the
 * value there and names it here, so the two cannot drift apart. The words each longhand takes are
 * measured into `shapes.generated.ts` beside the family's shape.
 *
 * It says nothing about a value it cannot READ. A hole is not the text the author wrote — the
 * reason written above `non-canonical-spelling` — and what a `var()` holds is unknown until the
 * browser reads it, which is the same reason the splitter refuses to split one.
 *
 * `!important` is taken off first. It is part of the value's text here, and a rule that read it as
 * a word would report `important` as a value `place-items` has no place for.
 */
export function wordOutOfItsLonghand(block: Block, findings: Finding[]): void {
  for (const item of declarationsIn(block)) {
    const shape = SHAPES[propertyName(item.property)];
    if (shape === undefined) continue;

    const [part] = item.value;
    if (item.value.length !== 1 || part === undefined || part.kind !== "text" || part.at === undefined) continue;
    if (holdsVar(part.text)) continue;

    const bare = part.text.replace(/!\s*important\s*$/i, "");
    const misplaced = misplacedWord(shape, bare.trim());
    if (misplaced === undefined) continue;

    // Where the WORD is, not where the value starts: the reader is looking for the one token.
    const offset = bare.indexOf(misplaced.word);
    const at = part.at + (offset < 0 ? 0 : offset);
    /**
     * Said once. `unknown-value` asks whether the PROPERTY takes the word at all and gets there
     * first for most of them — `place-items: start space-between` is not a `place-items` value
     * either way, and two reports on one character is one too many. What is left for this rule is
     * the word the property DOES take and the longhand it lands on does not: measured over every
     * family in the table, five values, and `place-items: left anchor-center` is one — ignored by
     * all three engines and named by nothing else.
     */
    if (findings.some((one) => one.at === at)) continue;
    findings.push({
      rule: "word-out-of-its-longhand",
      at,
      length: misplaced.word.length,
      message:
        `\`${misplaced.longhand}\` has no \`${misplaced.word}\`, and that is the part of the value ` +
        `reaching it. A browser drops the whole declaration, so this line sets nothing — set each ` +
        `longhand on its own.`,
    });
  }
}

/**
 * A value outside the closed list a project gave this property — `z-index: 5` under `[0, 1, 10]`.
 *
 * `var()` and the CSS-wide keywords go in, because neither is a value somebody chose: one is the
 * escape CSS itself provides and the others mean *inherit this* rather than *be this*. A value
 * carrying a HOLE is left alone, for the reason written above `non-canonical-spelling`: what the
 * hole evaluates to is not the text the author wrote.
 */
export function valueNotAllowed(block: Block, rules: PropertyRules | undefined, findings: Finding[]): void {
  if (rules === undefined) return;

  for (const item of declarationsIn(block)) {
    const property = propertyName(item.property);
    const values = ruleFor(rules, property).values;
    if (values === undefined || item.value.some((part) => part.kind !== "text")) continue;

    const written = item.value
      .map((part) => (part.kind === "text" ? part.text : ""))
      .join("")
      .trim();
    if (written === "" || GLOBAL.has(written.toLowerCase()) || written.startsWith("var(")) continue;
    /**
     * A QUOTED value is `string-not-allowed`'s, and this one used to speak beside it.
     *
     * Reported by the user, who read the type and the rule together and saw a contradiction:
     * `z-index: "1"` gave two findings, and the second said *takes only 0, 1, 10 … and this is
     * `"1"`* — naming a value that IS in the list. The fault is the quoting, not the number, and
     * the other rule says exactly that.
     *
     * The string spellings in the TYPE are a different thing and are not a widening of what the
     * project permitted: a block is CSS, so `z-index: 1` reaches the type as `"1"`. Both
     * spellings mean one declaration, and a hole may hand over either.
     */
    if (written.startsWith('"') || written.startsWith("'")) continue;
    // Both spellings, because a block is CSS: `z-index: 5` arrives as the string `"5"`.
    if (values.some((one) => String(one) === written)) continue;

    findings.push({
      rule: "value-not-allowed",
      at: item.valueAt ?? item.at ?? 0,
      length: written.length,
      message:
        `\`${property}\` takes only ${values.map((one) => String(one)).join(", ")} in this project, ` +
        `and this is \`${written}\`.\n\n        Add it to \`values\` in \`ramonda.css.ts\`, or use ` +
        `one of those.`,
    });
  }
}

export function shorthandNotAllowed(block: Block, rules: PropertyRules | undefined, findings: Finding[]): void {
  if (rules === undefined) return;

  for (const item of declarationsIn(block)) {
    const property = propertyName(item.property);
    if (ruleFor(rules, property).shorthand !== false || SHORTHANDS[property] === undefined) continue;

    /**
     * A few of the longhands and the count, rather than all of them or an arbitrary four.
     *
     * `SHORTHANDS` holds every longhand a shorthand sets, TRANSITIVELY and sorted — `margin` has
     * ten, and the first four alphabetically are the logical ones rather than the four sides
     * somebody is looking for. Naming three and the number is honest about both: what to write,
     * and that there is more to choose from.
     */
    const all = SHORTHANDS[property];
    const shown = all.slice(0, 3).join(", ");
    const rest = all.length > 3 ? ` and ${all.length - 3} more` : "";

    findings.push({
      rule: "shorthand-not-allowed",
      at: item.at ?? 0,
      length: item.property.length,
      message:
        `\`${property}\` is a shorthand this project does not use.\n\n        Write a longhand ` +
        `instead — ${shown}${rest} — or name it in \`properties\` with \`shorthand: true\`.`,
    });
  }
}
