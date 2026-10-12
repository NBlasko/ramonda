/** Rules about a declaration's VALUE: a word, a unit, a flag, a string, how many values, a `url()`. */

import { type PropertyRules, type UnitsByFamily } from "../../config/config";
import {
  ARITY,
  FUNCTIONS,
  KEYWORDS,
  PROPERTIES,
  PROPERTY_NAMED,
  SHORTHANDS,
  UNION_TYPED,
  UNITS,
  UNIT_TYPE,
} from "../keywords.generated";
import { splitOf, tokensOf } from "../split";
import { valueMatchesGrammar } from "../validateValue";
import { ENGINE_OPEN } from "../keywords.engine.generated";
import { canonicalValue, propertyName } from "../normalise";
import { type Declaration, type ValuePart, textOnly, textPartsOf } from "../ast";
import { urlsIn, withoutQuery } from "../urlsIn";
import { wordSet } from "../wordSet";
import { nearest } from "../nearest";
import { NUMBERLESS } from "../numberless.generated";
import {
  UNIT_KIND_REFUSED,
  UNIT_REQUIRED,
  UNIT_REQUIRED_EVERYWHERE,
  WHOLE_NUMBER,
  WHOLE_NUMBER_EVERYWHERE,
} from "../numbers.generated";
import { GLOBAL, KNOWN, STRINGS_FIT, type Block, words, declarationsIn, withoutImportant } from "./shared";
import { type Finding } from "./index";
import { bareColon, endOfCall, endOfString, terminator } from "./text";
import { PREFIXES, onlyCase } from "./properties";

/**
 * More values than this project allows a property to take — `padding: 8px 12px` under `arity: 1`.
 *
 * **A rule rather than a type, and that is measured.** A type for this is a template literal over
 * the permitted values, and at 49 units by four positions TypeScript SILENTLY STOPS CHECKING — no
 * `TS2590`, no message, it simply accepts anything:
 *
 *     1 unit,   arity 4    refuses `8pxx`
 *     49 units, arity 2    refuses `8pxx`
 *     49 units, arity 4    ACCEPTS `8pxx`
 *
 * A type that quietly stops checking is worse than no type, because the whole file stays green. The
 * checker has no such threshold, and the message here is one somebody can act on.
 *
 * Counting is by TOP-LEVEL space, so `calc(1rem + 2px)` and `rgb(0 0 0)` are one value each — the
 * spaces inside a call belong to the call. A hole is one value too: what it evaluates to is decided
 * at render and nothing here knows how many words it will be.
 */
export function tooManyValues(block: Block, rules: PropertyRules | undefined, findings: Finding[]): void {
  /**
   * The most values this property may take here: CSS's own maximum, narrowed by what the config
   * said — and never widened by it.
   *
   * **CSS's maximum applies with no config at all**, because exceeding it is not a project's
   * opinion, it is invalid CSS: `padding: 4px 0 0 0 0` is five values where CSS gives four.
   *
   * **And a config may only narrow.** Unclamped, `"*": { arity: 4 }` would leave `padding-block:
   * 1px 2px 3px` silent, because the sweep's four is higher than the two CSS gives that property.
   * The same `Math.min` answers both.
   *
   * `ARITY` holds the sixteen properties that repeat one longhand, which is the whole set where
   * "how many" has an answer. `border-left` is `<line-width> || <line-style> || <color>` — three
   * different things, so `4px solid red` is one value in three parts, and counting it under `"*": {
   * arity: 1 }` would refuse correct CSS.
   */
  const allowed = (property: string): { most: number; whose: "css" | "project" } | undefined => {
    const css = ARITY[property];
    const own = (rules?.[property as keyof PropertyRules] ?? {}) as { arity?: number };
    const sweep = (rules?.["*"] ?? {}) as { arity?: number };
    // The sweep reaches only the properties CSS gives an arity; a NAMED one is always meaningful,
    // because the config type permits an arity on those sixteen and nowhere else.
    const said = own.arity ?? (css === undefined ? undefined : sweep.arity);

    if (css === undefined) return said === undefined ? undefined : { most: said, whose: "project" };
    if (said === undefined) return { most: css, whose: "css" };
    return said < css ? { most: said, whose: "project" } : { most: css, whose: "css" };
  };

  for (const item of declarationsIn(block)) {
    const property = propertyName(item.property);
    const limit = allowed(property);
    if (limit === undefined || item.at === undefined) continue;

    /**
     * A declaration that swallowed the next one is `run-on-declaration`'s to report, not this.
     *
     * `padding: 8px border-left: 4px solid red` parses as one declaration with a great many values,
     * so counting them would make two reports for one mistake — and the other one names the actual
     * fault and the missing `;`.
     *
     * The tell is the same one that rule uses: a bare colon in a value, which CSS values do not
     * contain.
     */
    if (item.value.some((part) => part.kind === "text" && bareColon(part.text) !== -1)) continue;

    /**
     * `!important` is a FLAG, not a value.
     *
     * Counted as one, `padding: 4px 0 0 0 !important` is five values and refused — and every
     * finding these rules produce refuses the build, so a page every browser renders would not
     * compile. A family whose maximum is four hides it; `place-items`, which takes two, does not.
     *
     * The spelling is the one `split.ts` already uses, where `!important` is taken off before a
     * value is read at all: optional space after the bang, any case.
     */
    const written = topLevelValues(item.value);
    const last = (written.at(-1)?.text ?? "").trim();
    const before = (written.at(-2)?.text ?? "").trim();
    // `! important` is two values to a splitter and one flag to CSS — measured honoured in all
    // three engines, which is why `split.ts` puts every spelling of it back verbatim.
    const flag = /^!\s*important$/i.test(last) ? 1 : last.toLowerCase() === "important" && before === "!" ? 2 : 0;
    const values = written.length - flag;
    if (values <= limit.most) continue;

    const takes = limit.most === 1 ? "one value" : `at most ${limit.most} values`;

    findings.push({
      rule: "too-many-values",
      at: item.valueAt ?? item.at,
      length: (item.end ?? item.at) - (item.valueAt ?? item.at),
      message:
        limit.whose === "css"
          ? `\`${property}\` takes ${takes} in CSS, and this is ${values}.`
          : `\`${property}\` takes ${takes} in this project, and this is ${values}.` +
            `\n\n        Set each side on its own, or raise \`arity\` in \`ramonda.css.ts\`.`,
    });
  }
}

/** One top-level value of a declaration, and where it starts. See {@link topLevelValues}. */
interface TopLevel {
  /** The text, or `undefined` for a HOLE — whose value is decided at render and is nobody's to read. */
  readonly text: string | undefined;
  readonly at: number | undefined;
}

/**
 * A declaration's values, separated the way CSS separates them: by a space at depth zero.
 *
 * `calc(1rem + 2px)` and `rgb(0 0 0)` are ONE value each — the spaces inside a call belong to the
 * call. A hole is one value too, and an opaque one: what it evaluates to is decided at render.
 *
 * **Shared on purpose**: `too-many-values` and the rules beside it need the same answer, and a
 * second scanner that agrees by accident is this repository's recurring fault. One walk, one
 * answer, every caller.
 */
export function topLevelValues(parts: readonly ValuePart[]): TopLevel[] {
  const out: TopLevel[] = [];
  let depth = 0;
  let open: { text: string; at: number | undefined } | undefined;

  const close = (): void => {
    if (open !== undefined) out.push(open);
    open = undefined;
  };

  for (const part of parts) {
    if (part.kind !== "text") {
      // A hole glued to text is part of that value; on its own it is a value of its own.
      if (open === undefined) out.push({ text: undefined, at: undefined });
      else open = { text: `${open.text}\u0000`, at: open.at };
      continue;
    }
    for (const [index, character] of [...part.text].entries()) {
      if (character === "(") depth++;
      else if (character === ")") depth--;

      if (depth === 0 && /\s/.test(character)) {
        close();
        continue;
      }
      if (open === undefined) open = { text: character, at: part.at === undefined ? undefined : part.at + index };
      else open = { text: open.text + character, at: open.at };
    }
  }
  close();
  return out;
}

/**
 * A relative `url( … )` that points at no file.
 *
 * Measured through a real Vite build: `url("./img/missing.png")` built without a word and shipped as
 * written — a 404 in the browser, so a moved image broke nothing anyone saw. TypeScript cannot help:
 * the `*.png` declaration a Vite project has accepts any path, existing or not. So the disk is asked,
 * beside the source file. Only `./` and `../` paths: one from the site's root (`/hero.png`) lives
 * wherever the bundler's public folder is, which this does not guess; a query or a fragment is not
 * part of the file. Reported on the path itself.
 */
export function urlNotFound(
  block: Block,
  exists: (relative: string) => boolean,
  file: string,
  findings: Finding[],
): void {
  for (const item of declarationsIn(block)) {
    for (const part of textPartsOf(item.value)) {
      if (part.at === undefined) continue;
      // Read by `urlsIn`, not a regex — see it for the two CodeQL found.
      for (const { path, at } of urlsIn(part.text)) {
        if (!path.startsWith("./") && !path.startsWith("../")) continue;
        if (exists(withoutQuery(path))) continue;
        findings.push({
          rule: "url-not-found",
          at: part.at + at,
          length: path.length,
          message:
            `\`${path}\` does not exist next to \`${file}\`, so the browser gets a 404 for it. Fix the path, ` +
            "or put the file back — a relative `url()` is read from the folder of the file that holds the block.",
        });
      }
    }
  }
}

/**
 * A bare word in a value that the property does not accept.
 *
 * This is the half the types gave up on. A property whose grammar is a closed keyword set gets a
 * real union and TypeScript reports it; the other 428 take COMBINATIONS — `display: inline flow-root`
 * — and a union of their single keywords would reject valid CSS.
 *
 * A checker has no such constraint, because it reads one token and says something about that token
 * alone. `KEYWORDS` holds the properties whose grammar admits no arbitrary identifier; a property
 * reachable through `<custom-ident>` and its kind is absent, because `animation-name: slidein` is a
 * name the author invented and nothing here can judge it.
 */
export function unknownValue(item: Declaration, findings: Finding[]): void {
  numberDropped(item, findings);

  const names = PROPERTY_NAMED[item.property];
  if (names !== undefined) return propertyNames(item, names, findings);

  numberWhereKeywordsGo(item, findings);

  const accepted = KEYWORDS[item.property];
  if (accepted === undefined) return;

  // An EMPTY row is a property that accepts no keyword at all — `wordSet` gives it an empty set.
  const keywords = wordSet(accepted);
  /** Whether any word's only fault was its case — see the note beside the check below. */
  let miscased = false;

  for (const word of words(item.value)) {
    /**
     * A word that starts with a dash is never a keyword.
     *
     * `display: -webkit-box` and `cursor: -webkit-grab` are CSS that works: the vendor's own
     * vocabulary is not in any generated row, and it never will be — `mdn-data` holds the
     * unprefixed names. A `--`-prefixed word is the other half, and it is valid for eighteen
     * properties: `anchor-name: --card`, `view-timeline-name: --t`.
     *
     * `propertyNames` below skips them for the same reason; one question — is a dashed word a
     * keyword — must have one answer.
     */
    if (word.text.startsWith("-")) continue;
    if (keywords.has(word.text) || GLOBAL.has(word.text)) continue;
    /**
     * **A keyword in the wrong CASE is the same CSS**, and saying it does not exist is a lie the
     * author cannot act on. Measured over all 897 property/keyword pairs in the generated table:
     * 897 valid declarations were refused, every one of them for its case alone. And measured in
     * Chromium, of 314 pairs it accepts it accepts every one in BOTH cases, with no exceptions.
     *
     * The verdict is unchanged — still refused — and the id is the one this package already uses for
     * one CSS written two ways, which the formatter then rewrites. Reported once per declaration
     * rather than once per word, because the fix is the whole value.
     */
    if (keywords.has(word.text.toLowerCase()) || GLOBAL.has(word.text.toLowerCase())) {
      miscased = true;
      continue;
    }

    const meant = nearest(word.text, [...keywords]);
    findings.push({
      rule: "unknown-value",
      at: word.at ?? item.valueAt ?? item.at ?? 0,
      length: word.text.length,
      message:
        meant === undefined
          ? `\`${item.property}\` does not accept \`${word.text}\`.`
          : `\`${item.property}\` does not accept \`${word.text}\`. Did you mean \`${meant}\`?`,
    });
  }

  if (!miscased || findings.length > 0) return;
  /**
   * A value carrying a HOLE is left alone, and silence is the safe direction here: the hole is a
   * runtime value, so the text this would name is not the text the author wrote.
   */
  const written = textOnly(item.value);
  if (written === undefined) return;

  const canonical = canonicalValue(item.property, written);
  if (onlyCase(written, canonical)) return;

  findings.push({
    rule: "non-canonical-spelling",
    at: item.valueAt ?? item.at ?? 0,
    length: written.length,
    message:
      `write this as \`${canonical}\` — a CSS keyword is ` +
      `case-insensitive, so the two are the same declaration, and one spelling is what lets two ` +
      `blocks writing it agree on one class. \`ramonda-css format\` fixes it.`,
  });
}

/**
 * A value whose bare words are keywords or PROPERTY NAMES — `transition-property`, `will-change`,
 * and the `transition` shorthand.
 *
 * Their grammars admit a free identifier, which is normally the honest reason to check nothing: a
 * name somebody invented cannot be told from a name somebody mistyped. Here it can, because the
 * identifier is a property name and that is a closed set this package already generates.
 *
 * **The shorthand is checked by elimination rather than by a model of its grammar.** `transition`
 * mixes a property, two times and an easing function in one comma-separated list, and nothing here
 * parses that. It does not have to: a time is not a bare word, `cubic-bezier( … )` is a function, and
 * the keywords come from the longhands — so what is left is a property name. `animation` is
 * deliberately not treated the same way, because `animation-name` is the author's own `@keyframes`.
 *
 * **Three things are not typos and must not be reported.** A vendor-prefixed property is not in the
 * generated list, which holds only unprefixed names. A custom property is animatable and is the
 * author's own word. And a CSS-wide keyword is accepted everywhere.
 */
function propertyNames(item: Declaration, accepted: string, findings: Finding[]): void {
  const keywords = wordSet(accepted);

  for (const word of words(item.value)) {
    if (word.text.startsWith("-")) continue;
    if (keywords.has(word.text) || GLOBAL.has(word.text) || KNOWN.has(word.text)) continue;

    const meant = nearest(word.text, PROPERTIES as string[]);
    findings.push({
      rule: "unknown-value",
      at: word.at ?? item.valueAt ?? item.at ?? 0,
      length: word.text.length,
      message:
        `\`${item.property}\` does not accept \`${word.text}\` — it takes a property name` +
        (keywords.size === 0 ? "." : ` or one of ${[...keywords].sort().join(", ")}.`) +
        (meant === undefined ? "" : ` Did you mean \`${meant}\`?`),
    });
  }
}

/**
 * **A MISSPELT `!important`, which drops the declaration silently.**
 *
 * CSS has exactly one flag, and a bang at the end of a value that is not it makes the whole
 * declaration invalid. Measured in Chromium by inserting the rule and counting what it holds:
 *
 *     color: red !important; gap: 8px;    3 declarations kept
 *     color: red !importantt; gap: 8px;   2 — the colour is gone, the gap survives
 *     color: red !urgent; …               2
 *     color: red !; …                     2
 *
 * `unknown-value` is the wrong id, since the word is not a value and the property does not decide
 * what is allowed there: there is one flag, whatever the property.
 *
 * Only a TRAILING bang is a flag. One inside a string or a `url()` is ordinary text, which is why
 * this asks the value's own parts rather than searching the text.
 */
export function unknownFlag(item: Declaration, findings: Finding[]): void {
  // A value carrying a hole is decided at render, so the text here is not the text that ships.
  const written = textOnly(item.value);
  if (written === undefined) return;

  const bang = lastBangOutsideAString(written);
  if (bang === -1) return;

  const flag = written.slice(bang + 1).trim();
  if (/^important$/i.test(flag)) return;

  findings.push({
    rule: "unknown-flag",
    at: (item.valueAt ?? item.at ?? 0) + bang,
    length: written.length - bang,
    message:
      (flag === ""
        ? "a `!` at the end of a value is the start of `!important`, and there is nothing after it"
        : `\`!${flag}\` is not a flag — CSS has one, \`!important\``) +
      ", so a browser drops this declaration whole rather than reading the value. " +
      "Write `!important`, or remove the `!`.",
  });
}

/**
 * The last `!` that is really a FLAG — not one inside a string or a function, where it is text.
 *
 * Measured in Chromium: `background: url(a!b.png)` is kept, and so is the same with a real
 * `!important` after it. A flag sits at the top level of a value, after everything else.
 */
function lastBangOutsideAString(text: string): number {
  let bang = -1;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 34 || code === 39) {
      index = endOfString(text, index);
      continue;
    }
    if (code === 40 /* ( */) depth++;
    else if (code === 41 /* ) */) depth = Math.max(0, depth - 1);
    else if (code === 33 && depth === 0) bang = index;
  }
  return bang;
}

/**
 * A CSS number, which is more than the shape a person types.
 *
 * Measured in Chromium, all of these are kept as frames: `.5%` becomes `0.5%`, `1e2%` becomes
 * `100%`, `+50%` becomes `50%`. A rule written from `50%` alone reported four correct spellings — so
 * this is the grammar rather than the habit, and the range is asked separately, because `150%` is a
 * number this matches and a frame the browser drops.
 */
export const NUMBER = /^[+]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/;

/** The same, carrying a `%`, with the number kept so its range can be asked. */
export const PERCENTAGE = /^([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)%$/;

/** Every unit CSS has, for the question below. */
export const KNOWN_UNITS = new Set(UNITS);

/**
 * A number and the letters against it, which is the shape both unit rules look for.
 *
 * The EXPONENT is part of the number — `1e2px` is `100px`, css-syntax-3 §4.3.12 — and without it
 * the letters matched would be `e`, reporting *`e` is not a CSS unit* on valid CSS.
 *
 * And the unit may not be followed by a word character, which is what keeps a bare `2e3` out: with
 * the exponent optional, the engine would otherwise back off to a unit of `e` and leave the `3`.
 */
const A_UNIT = /(?<![\w.#-])(?:\d*\.)?\d+(?:[eE][+-]?\d+)?(?![eE][+-]?\d)(%[\w-]*|[a-zA-Z_][\w-]*)/g;

/**
 * A number whose decimal point has no digit after it — `0.`, `1.`. CSS reads the point as a separate
 * character, so the value is not one: measured, all three engines drop `opacity: 0.`.
 */
const A_BARE_POINT = /(?<![\w.#-])\d+\.(?![\w.])/g;

/**
 * Every unit written in a value, with the two places one is not a unit stepped over.
 *
 * **One walk for both unit rules**, so neither reads a text part raw. Read raw, `content: "3rd"`
 * gives *`rd` is not a CSS unit. Did you mean `rad`?* and `url(16em.svg)` gives *`em` is a CSS unit
 * this project does not use* — and there is no config an author could write to make them correct.
 * `words()` steps over the same two.
 *
 * A STRING is its own grammar: a `<string-token>`'s contents are text, not values. A `<url-token>`
 * is too — `url(a-16em.svg)` is a path, and CSS does not parse values inside one. An ordinary call
 * is NOT skipped, because `calc(100% - 4em)` and `rgb(0 0 0 / 50%)` hold real units in real value
 * positions.
 */
export function* unitsIn(text: string, at: number): Generator<{ unit: string; at: number; length: number }> {
  for (const stretch of valueStretches(text)) {
    for (const found of stretch.text.matchAll(A_UNIT)) {
      yield {
        unit: found[1],
        at: at + stretch.at + found.index + found[0].length - found[1].length,
        length: found[1].length,
      };
    }
  }
}

/** Every `1.` written in a value, outside strings and `url()`, the same stretches `unitsIn` reads. */
export function* barePointsIn(text: string, at: number): Generator<{ number: string; at: number }> {
  for (const stretch of valueStretches(text)) {
    for (const found of stretch.text.matchAll(A_BARE_POINT))
      yield { number: found[0], at: at + stretch.at + found.index };
  }
}

/** The stretches of a value that are value text — outside every string and every `url( … )`. */
function valueStretches(text: string): { text: string; at: number }[] {
  const stretches: { text: string; at: number }[] = [];
  let from = 0;
  let index = 0;

  while (index < text.length) {
    const code = text.charCodeAt(index);

    if (code === 34 || code === 39) {
      stretches.push({ text: text.slice(from, index), at: from });
      index = endOfString(text, index) + 1;
      from = index;
      continue;
    }
    // `url(`, matched case-insensitively because CSS function names are — and the closing paren is
    // found by the same scanner a value's own calls use.
    if ((code === 117 || code === 85) && /^url\s*\(/i.test(text.slice(index))) {
      stretches.push({ text: text.slice(from, index), at: from });
      index = endOfCall(text, text.indexOf("(", index)) + 1;
      from = index;
      continue;
    }
    index++;
  }
  stretches.push({ text: text.slice(from), at: from });
  return stretches;
}

/**
 * A unit CSS has and this project does not.
 *
 * The one rule here that is not about CSS at all. `em` is valid everywhere and a team may still
 * have decided against it — the fault is local to a project, so the list comes from
 * `ramonda.css.ts` and there is no default: a project that says nothing gets every unit CSS has.
 *
 * **Asked per FAMILY, and a family the config does not name is not constrained.** A flat list would
 * mean *every unit in CSS and nothing else*, and measured, `units: ["px", "rem"]` then reports
 * `200ms`, `50%`, `45deg` and `1fr` — four things nobody writing it intends. Keyed by family, the
 * rule a project wants is the rule it writes.
 *
 * An EMPTY list is a family banned outright, which is a thing somebody may well mean: `flex: []`
 * says this project does not use `fr`. So the test is whether the family was NAMED, never whether
 * its list has anything in it.
 *
 * It runs BESIDE `unknown-unit` rather than instead of it. A unit that is not a unit is a typo
 * wherever it is written; a unit the project has banned is a different sentence, and reading both
 * on one declaration would be two faults where there is one — so a unit CSS does not have is
 * skipped here and left to the rule that names it.
 */
export function unitNotAllowed(block: Block, allowed: UnitsByFamily, findings: Finding[]): void {
  /** By family, lower-cased once, so the walk below asks a set rather than a list. */
  const permitted = new Map<string, ReadonlySet<string>>(
    Object.entries(allowed).map(([family, units]) => [family, new Set((units ?? []).map((one) => one.toLowerCase()))]),
  );

  for (const item of declarationsIn(block)) {
    for (const part of item.value) {
      if (part.kind !== "text" || part.at === undefined) continue;

      for (const found of unitsIn(part.text, part.at)) {
        const unit = found.unit.toLowerCase();
        if (!KNOWN_UNITS.has(unit)) continue;

        const family = UNIT_TYPE[unit];
        const allowedHere = family === undefined ? undefined : permitted.get(family);
        if (allowedHere === undefined || allowedHere.has(unit)) continue;

        const listed = [...allowedHere].sort().join(", ");
        findings.push({
          rule: "unit-not-allowed",
          at: found.at,
          length: found.length,
          message:
            `\`${found.unit}\` is a ${family} this project does not use. \`ramonda.css.ts\` allows ` +
            `${listed === "" ? `no ${family} at all` : listed}.`,
        });
      }
    }
  }
}

/**
 * A number whose unit is NEARLY one — `150oms`, `10pxx`.
 *
 * **A membership test, not a near miss**: `150xxms` and `150asdasdms` are not within an edit or two
 * of `ms`, and a near-miss test passes both. The membership test is safe because the supplement
 * completes `mdn-data`'s unit list — measured, every exotic real unit is in the set, `q` and `x`
 * and `ic` and `rcap` and `dppx` and `svmin` and `cqmax` among them. The near miss only chooses the
 * SUGGESTION.
 *
 * The one risk worth naming: a unit invented after this list was generated is reported until the
 * list is regenerated, which is `scripts/css/build-css-properties.mjs` and one command.
 */
export function unknownUnit(item: Declaration, findings: Finding[]): void {
  for (const part of item.value) {
    if (part.kind !== "text" || part.at === undefined) continue;

    for (const found of barePointsIn(part.text, part.at)) {
      findings.push({
        rule: "malformed-number",
        at: found.at,
        length: found.number.length,
        message: `\`${found.number}\` is not a number CSS reads: a decimal point needs a digit after it, so a browser drops this declaration. Write \`${found.number.slice(0, -1)}\`.`,
      });
    }
    for (const found of unitsIn(part.text, part.at)) {
      const unit = found.unit.toLowerCase();
      if (KNOWN_UNITS.has(unit)) continue;

      const meant = nearest(unit, UNITS as string[]);
      findings.push({
        rule: "unknown-unit",
        at: found.at,
        length: found.length,
        message: `\`${found.unit}\` is not a CSS unit.` + (meant === undefined ? "" : ` Did you mean \`${meant}\`?`),
      });
    }
  }
}

const KNOWN_FUNCTIONS = new Set(FUNCTIONS);

/** Each call in a value — its name and where the name starts — skipping strings and what `url()` holds. */
function* callsIn(text: string): Generator<{ name: string; index: number }> {
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 34 || code === 39) {
      index = endOfString(text, index) + 1;
      continue;
    }
    const name = /^-{0,2}[a-zA-Z_][\w-]*/.exec(text.slice(index, index + 64))?.[0];
    if (name === undefined || (index > 0 && /[\w-]/.test(text[index - 1]))) {
      index++;
      continue;
    }
    const open = index + name.length;
    if (text[open] === "(") {
      yield { name, index };
      // What `url()` holds is a path, and what a vendor's own call holds is that vendor's grammar —
      // `-webkit-gradient(…, from(red), to(blue))` — so neither is read for calls.
      if (name.toLowerCase() === "url" || /^-[a-z]+-/i.test(name)) {
        index = endOfCall(text, open) + 1;
        continue;
      }
    }
    index = open;
  }
}

/**
 * A call to a function CSS does not have — `d(--accent)`, `vra(--accent)`.
 *
 * Measured with `CSS.supports` in Chromium 156, Firefox 157 and WebKit 27.2: all three refuse
 * `width: d(10px)`, so the declaration is dropped, and nothing in this package said so. The list is
 * every function a `mdn-data` grammar calls plus the ones an engine parses that none names — see
 * `FUNCTIONS`. A vendor's own (`-webkit-gradient`) is the browser's, so only its prefix is checked.
 *
 * And a call to a CSS CUSTOM function, `--double(10px)`, is refused outright: Firefox 157 drops every
 * declaration that calls one. See DESIGN, "Custom functions".
 */
export function unknownFunction(item: Declaration, findings: Finding[]): void {
  for (const part of item.value) {
    if (part.kind !== "text" || part.at === undefined) continue;

    for (const { name, index } of callsIn(part.text)) {
      const lowered = name.toLowerCase();
      if (lowered.startsWith("--")) {
        findings.push(customFunction(part.at + index, name.length));
        continue;
      }
      if (KNOWN_FUNCTIONS.has(lowered)) continue;
      const prefix = /^(-[a-z]+-)/.exec(lowered)?.[1];
      if (prefix !== undefined && PREFIXES.includes(prefix)) continue;

      const meant = nearest(lowered, FUNCTIONS as string[]);
      findings.push({
        rule: "unknown-function",
        at: part.at + index,
        length: name.length,
        message:
          `\`${name}()\` is not a CSS function, so a browser drops this declaration.` +
          (meant === undefined ? "" : ` Did you mean \`${meant}()\`?`),
      });
    }
  }
}

const REFUSED_KINDS = new Set(UNIT_KIND_REFUSED);
const KIND_WORDS: Readonly<Record<string, string>> = {
  length: "a length",
  angle: "an angle",
  time: "a time",
  frequency: "a frequency",
  resolution: "a resolution",
  flex: "a share of the free space",
  percentage: "a percentage",
};

/** Whether each character of a value stands outside every call — a unit inside `calc()` is the call's. */
function topLevel(text: string): boolean[] {
  const outside: boolean[] = [];
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 34 || code === 39) {
      const end = endOfString(text, index);
      for (let one = index; one <= end && one < text.length; one++) outside[one] = false;
      index = end;
      continue;
    }
    if (code === 40) depth++;
    outside[index] = depth === 0;
    if (code === 41) depth = Math.max(0, depth - 1);
  }
  return outside;
}

/**
 * A real unit of a kind the property drops — `z-index: 2x`, `x` being a resolution; `width: 2s`.
 * `unknown-unit` knows the unit exists and nothing asked whether THIS property takes its kind. Found
 * silent by `check-engine-sweep.mjs`.
 *
 * The table is measured, `UNIT_KIND_REFUSED` in `numbers.generated.ts`: each LONGHAND that takes some
 * number, asked one unit of each kind alone, believed only where every engine refuses. A shorthand is
 * never in it, since one value alone says nothing about another slot. A unit inside a call is the
 * call's — `line-height: calc(1px * 2)` — and is not asked.
 */
export function unitOfTheWrongKind(item: Declaration, findings: Finding[]): void {
  const property = item.property.toLowerCase();
  for (const part of item.value) {
    if (part.kind !== "text" || part.at === undefined || part.resolved) continue;
    const outside = topLevel(part.text);
    for (const found of unitsIn(part.text, part.at)) {
      if (!outside[found.at - part.at]) continue;
      const unit = found.unit.toLowerCase();
      const kind = UNIT_TYPE[unit];
      if (kind === undefined || !REFUSED_KINDS.has(`${property} ${kind}`)) continue;
      findings.push({
        rule: "unit-of-the-wrong-kind",
        at: found.at,
        length: found.length,
        message: `\`${found.unit}\` is ${KIND_WORDS[kind] ?? kind} unit, and \`${item.property}\` takes none, so a browser drops this declaration.`,
      });
    }
  }
}

/**
 * A SHORTHAND's units, each asked of the longhand it lands in — `margin: 0x auto` puts `0x` in
 * `margin-top`, which takes no resolution. The table is per longhand (see `unitOfTheWrongKind`), so a
 * shorthand is read through `splitOf`, the same split the build writes. A value it does not split is
 * left alone here. Found silent by `check-engine-sweep.mjs`.
 */
export function unitOfTheWrongKindInItsLonghands(item: Declaration, findings: Finding[]): void {
  const property = item.property.toLowerCase();
  if (SHORTHANDS[property] === undefined || item.value.some((part) => part.kind !== "text" || part.resolved)) return;
  const [part] = item.value;
  if (item.value.length !== 1 || part.kind !== "text" || part.at === undefined) return;
  const split = splitOf(property, part.text);
  if (split === undefined) return;

  const outside = topLevel(part.text);
  for (const found of unitsIn(part.text, part.at)) {
    const offset = found.at - part.at;
    if (!outside[offset]) continue;
    const kind = UNIT_TYPE[found.unit.toLowerCase()];
    if (kind === undefined) continue;
    // The whole token the unit ends — `0x` — and every longhand that took it.
    // Walked back by hand: a pattern anchored at the end is tried from every start, quadratic in a run
    // of digits.
    let start = offset;
    while (start > 0 && /[\d.eE+-]/.test(part.text[start - 1])) start--;
    const token = part.text.slice(start, offset + found.length);
    const into = Object.entries(split).find(
      ([longhand, value]) => tokensOf(value).includes(token) && REFUSED_KINDS.has(`${longhand} ${kind}`),
    );
    if (into === undefined) continue;
    findings.push({
      rule: "unit-of-the-wrong-kind",
      at: found.at,
      length: found.length,
      message: `\`${found.unit}\` is ${KIND_WORDS[kind] ?? kind} unit, and \`${into[0]}\` — where \`${token}\` lands in \`${item.property}\` — takes none, so a browser drops this declaration.`,
    });
  }
}

/**
 * A value its property's grammar cannot read — `rgb(1x 2 3)`, `linear-gradient(redx, blue)`,
 * `aspect-ratio: 16  9`. Asked last and only where no other rule spoke, so a fault a word gives away
 * is named by the rule that names it. See `validateValue.ts` for what was measured, and
 * `check-value-grammar.mjs` for the gate that keeps a valid value from being refused.
 */
export function invalidValue(item: Declaration, findings: Finding[]): void {
  if (item.value.length !== 1) return;
  const [part] = item.value;
  if (part.kind !== "text" || part.resolved || part.at === undefined) return;
  const property = item.property.toLowerCase();
  // A vendor's own name or word is that vendor's vocabulary, and no grammar here has it — the same
  // line every rule in this file draws. A property with a whole union for a type is the compiler's
  // to answer, and it answers with a suggestion this cannot give.
  // And a property the ENGINES take more of than its grammar says — `column-rule-style: solid, dashed`
  // — is one this cannot judge: `ENGINE_OPEN` is the measured list.
  if (property.startsWith("-") || UNION_TYPED.includes(property) || ENGINE_OPEN.includes(property)) return;
  if (/(?:^|[\s,(/])-(?:webkit|moz|ms|o|apple|epub)-/i.test(part.text)) return;
  if (valueMatchesGrammar(property, part.text) !== false) return;
  const text = withoutImportant(part.text).trimEnd();
  const lead = text.length - text.trimStart().length;
  findings.push({
    rule: "invalid-value",
    at: part.at + lead,
    length: text.trim().length,
    message: `\`${text.trim()}\` is not a value \`${item.property}\` takes, so a browser drops this declaration.`,
  });
}

/** Each `#word` in a value, skipping strings and what `url()` holds — a fragment there is a path. */
function* hashesIn(text: string): Generator<{ hash: string; index: number }> {
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 34 || code === 39) {
      index = endOfString(text, index) + 1;
      continue;
    }
    if (/^url\(/i.test(text.slice(index, index + 4)) && (index === 0 || !/[\w-]/.test(text[index - 1]))) {
      index = endOfCall(text, index + 3) + 1;
      continue;
    }
    if (code === 35) {
      const hash = /^#[\w-]*/.exec(text.slice(index, index + 64))?.[0] ?? "#";
      yield { hash, index };
      index += hash.length;
      continue;
    }
    index++;
  }
}

/**
 * A hex colour with the wrong number of digits, or a letter that is not a hex digit — `#abcx`,
 * `#ab`, `#12345`. Measured: Chromium, Firefox and WebKit all drop the declaration. Found by
 * `check-engine-sweep.mjs`; nothing reported it, because no type or rule reads a hex colour's shape.
 */
export function invalidHexColor(item: Declaration, findings: Finding[]): void {
  for (const part of item.value) {
    if (part.kind !== "text" || part.at === undefined) continue;
    for (const { hash, index } of hashesIn(part.text)) {
      if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(hash)) continue;
      // Glued to the hole after it — `#$(hex)` — which is one fault, and it is the hole's.
      if (index + hash.length === part.text.length && part !== item.value.at(-1)) continue;
      findings.push({
        rule: "invalid-hex-color",
        at: part.at + index,
        length: hash.length,
        message: `\`${hash}\` is not a colour: a hex colour has 3, 4, 6 or 8 hex digits, so a browser drops this declaration.`,
      });
    }
  }
}

/** The one sentence a custom function gets, at its call and at its `@function`. */
export function customFunction(at: number, length: number): Finding {
  return {
    rule: "custom-function",
    at,
    length,
    message:
      "CSS custom functions are not offered: Firefox drops `@function` and every declaration that calls one. " +
      "Compute the value with `calc()`, a token, or a `@@property` set from code.",
  };
}

/**
 * A quoted string where the property's grammar has no place for one.
 *
 * A block's value is a TypeScript string literal in the file the editor type-checks — `display:
 * flex` is `{display:"flex"}` there — so the editor has every reason to offer the word with quotes
 * round it. Accepting that offer compiles, ships `color:"yellow"`, and every browser drops the
 * declaration.
 *
 * **"No strings" is not the rule, because two of these four are correct CSS:**
 *
 *     color: "yellow";        invalid — the quotes are part of a CSS string
 *     display: "flex";        invalid, the same way
 *     content: "hi";          correct — a `<string>` is what belongs there
 *     font-family: "Brand";   correct
 *
 * So it is asked of the grammar, out of the same sweep that answers every other value question:
 * `STRING_ALLOWED` holds the properties reaching `<string>` anywhere, and the ones whose grammar
 * nothing here can decide. A property this cannot judge is one it says nothing about.
 *
 * **Only at the top level, and that guard is the ONLY thing holding `url()` up.** `STRING_ALLOWED`
 * does NOT contain the `<url>` properties: `mdn-data` gives `<url>` no grammar and the generator's
 * walk cannot follow a functional reference like `<image-set()>`, so `background-image` and about
 * twenty relatives are absent from the set. Measured with the depth ignored, `background-image:
 * url("a.png")` is reported. So this is not the second of two defences; it is the one.
 *
 * One report per declaration. Two quoted words are one mistake.
 */
export function stringNotAllowed(item: Declaration, findings: Finding[]): void {
  if (!KNOWN.has(item.property) || STRINGS_FIT.has(item.property)) return;

  let depth = 0;
  for (const part of item.value) {
    // The compiler's own text, not the author's — it has no position and is nobody's typo.
    if (part.kind !== "text" || part.resolved) continue;
    const text = part.text;

    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 40 /* ( */) depth++;
      else if (code === 41 /* ) */ && depth > 0) depth--;
      else if (code === 34 || code === 39) {
        const closing = endOfString(text, index);
        if (depth > 0) {
          index = closing;
          continue;
        }

        const written = text.slice(index, Math.min(closing + 1, text.length));
        const inside = text.slice(index + 1, closing);
        findings.push({
          rule: "string-not-allowed",
          at: (part.at ?? item.valueAt ?? item.at ?? 0) + index,
          length: written.length,
          message:
            `\`${item.property}\` does not take a quoted string` +
            (inside === "" ? "." : `. Write \`${item.property}: ${inside};\`.`) +
            ` The quotes are part of a CSS string, so a browser drops the declaration.`,
        });
        return;
      }
    }
  }
}

/**
 * A bare NUMBER written where the property takes only keywords.
 *
 * The type catches some and not others: `position: 1` is refused because its grammar reduced to a
 * primitive, and `display: 1` is not, because `display` is `[ <display-outside> || <display-inside>
 * ] | …`, which the generator cannot reduce.
 *
 * **The gap could not be the key.** Absence from `PRIMITIVE` means the grammar was not reduced, and
 * `aspect-ratio`, `line-height` and `background-position` are absent too with a bare number being
 * correct CSS. `NUMBERLESS` is the positive fact instead: the properties every one of Chromium,
 * Firefox and WebKit refuses every bare number for. See `build-numberless-properties.mjs`.
 *
 * A HOLE is left alone, for the reason `non-canonical-spelling` gives: what a hole evaluates to is
 * not text the author wrote, and the types are what answer for it.
 */
const UNIT = new Set(UNIT_REQUIRED);
const UNIT_EVERYWHERE = new Set(UNIT_REQUIRED_EVERYWHERE);
const WHOLE = new Set(WHOLE_NUMBER);
const WHOLE_EVERYWHERE = new Set(WHOLE_NUMBER_EVERYWHERE);
const A_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * The words of a value at its top level, each with its offset — not inside a call, where `repeat(3,
 * 1fr)` and `calc(100% - 12px)` hold numbers that are right, and not inside a string.
 */
function topLevelWords(text: string): { word: string; at: number }[] {
  const out: { word: string; at: number }[] = [];
  let depth = 0;
  let quote = "";
  let start = -1;
  let called = false;
  const end = (at: number) => {
    if (start !== -1 && !called) out.push({ word: text.slice(start, at), at: start });
    start = -1;
    called = false;
  };
  for (let at = 0; at < text.length; at++) {
    const c = text[at];
    if (quote !== "") {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      called = true;
      continue;
    }
    if (c === "(") {
      depth++;
      called = true;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;
    if (/[\s,/]/.test(c)) {
      end(at);
      continue;
    }
    if (start === -1) start = at;
  }
  end(text.length);
  return out;
}

/**
 * A number a browser DROPS where no type can refuse it — `gap: 12` and `z-index: 1.5`.
 *
 * Both are lists the engines wrote: `numbers.generated.ts`, where every engine refuses the number
 * and accepts the right one. Measured in Chromium, Firefox and WebKit, each declaration below is
 * gone from the element without a word anywhere:
 *
 *     gap: 12         dropped — and `12px` and `0` are kept
 *     z-index: 1.5    dropped — and `1` is kept
 *
 * A number standing alone is reported for every property in the list. One AMONG other words only
 * where the engines were asked that too — `margin: 4px 12` is dropped, while the `0` in
 * `box-shadow: 0 0 1px red` is a length — which is the `_EVERYWHERE` half of each list. A zero is
 * never reported: it needs no unit.
 */
function numberDropped(item: Declaration, findings: Finding[]): void {
  // A name in capitals is the same property, and its value is dropped the same way.
  const property = item.property.toLowerCase();
  const unit = UNIT.has(property);
  const whole = WHOLE.has(property);
  if (!unit && !whole) return;

  const only = item.value.filter((part) => part.kind === "text" && !part.resolved);
  if (only.length !== item.value.length || only.length !== 1) return;
  const part = only[0];
  if (part.kind !== "text" || part.at === undefined) return;

  const text = withoutImportant(part.text.slice(0, terminator(part.text)));
  const all = topLevelWords(text);
  const numbers = all.filter((one) => A_NUMBER.test(one.word));
  const asked = (everywhere: Set<string>) => (all.length === 1 || everywhere.has(property) ? numbers : []);

  if (unit) {
    for (const one of asked(UNIT_EVERYWHERE)) {
      if (Number(one.word) === 0) continue;
      findings.push({
        rule: "number-without-a-unit",
        at: part.at + one.at,
        length: one.word.length,
        message:
          `\`${item.property}\` takes a length, and a browser drops \`${one.word}\` — a number with no ` +
          `unit is not one. Write \`${one.word}px\`, or the unit you meant.`,
      });
    }
  }
  if (whole) {
    for (const one of asked(WHOLE_EVERYWHERE)) {
      /**
       * Whole by its SPELLING, not by its value: all three engines drop `z-index: 1.0` and `1e2`, an
       * integer to `Number.isInteger`, because CSS reads `<integer>` off the token — digits, and
       * nothing else.
       */
      if (/^[+-]?\d+$/.test(one.word)) continue;
      const value = Number(one.word);
      const fix = Number.isInteger(value)
        ? `Write \`${value}\`.`
        : `Write \`${Math.floor(value)}\` or \`${Math.ceil(value)}\`.`;
      findings.push({
        rule: "fraction-where-a-whole-number-goes",
        at: part.at + one.at,
        length: one.word.length,
        message: `\`${item.property}\` takes a whole number, and a browser drops \`${one.word}\`. ${fix}`,
      });
    }
  }
}

function numberWhereKeywordsGo(item: Declaration, findings: Finding[]): void {
  if (!NUMBERLESS.includes(item.property)) return;

  /**
   * Only when the number is the WHOLE value, and that is the measurement's own boundary.
   *
   * `NUMBERLESS` records that a bare number alone is refused — `CSS.supports("box-shadow", "1")` is
   * false in all three engines. It says nothing about a number INSIDE a longer value, and measured,
   * `box-shadow: 0 0 1px red` is accepted by all three: the `0` there is a length, and the same is
   * true of `transform: scale(2)` and every call's argument.
   *
   * So a value with anything else in it is left to the walk below, which asks about its WORDS. A
   * number standing alone is the only shape this measurement licenses a word about.
   */
  const only = item.value.filter((part) => part.kind === "text" && !part.resolved);
  if (only.length !== item.value.length || only.length !== 1) return;

  const part = only[0];
  if (part.kind !== "text" || part.at === undefined) return;

  const text = part.text.slice(0, terminator(part.text)).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return;

  findings.push({
    rule: "unknown-value",
    at: part.at + part.text.indexOf(text),
    length: text.length,
    message:
      `\`${item.property}\` does not accept \`${text}\`. It takes a keyword, and no browser measured ` +
      `takes a number here.`,
  });
}
