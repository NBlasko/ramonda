/** Rules for the named sites: `@@property`, `@@keyframes`, `@@font-face`. */

import { MEDIA_FEATURES, UNIT_TYPE } from "../keywords.generated";
import { holdsVar } from "../split";
import { SPREAD, branchOf, holeIn } from "../read";
import { GLOBAL, type Block, type BlockItem, withoutImportant } from "./shared";
import { type Finding } from "./index";

/**
 * What a `syntax` component accepts, as a test on the value's own text.
 *
 * **Matchers rather than a classifier, and that is the whole safety of the rule.** Classifying the
 * value and comparing types fails the wrong way — an incomplete classification makes a good value
 * look like the wrong type and reports correct CSS. Asking each component "do you accept this" fails
 * by going quiet, because a component with no matcher here silences the rule entirely.
 *
 * They are LOOSE for the same reason, and each looseness is a report given up on purpose:
 *
 * - `<color>` accepts any bare word rather than a list of named colours, so a value that is really a
 *   `<custom-ident>` is never mistaken for a fault;
 * - `<length>` and its kind accept a number with ANY unit, because `units.json` does not group units
 *   by value type and a hand-written partition would rot — so `<length>` with `3s` is MISSED;
 * - anything holding a function is accepted wherever a function could go, because `calc()`,
 *   `min()` and `var()` can each be any type at all.
 *
 * What survives all of that is the case that actually happens: a value of visibly the wrong SHAPE.
 */
/**
 * A number, and it may carry an EXPONENT — css-syntax-3 §4.3.12, so `1e3` is a `<number>` and
 * `1e2px` is `100px`. A review found both reported: the matchers could not express the form at all,
 * and `unknown-unit` said `e` was not a unit on top of it.
 */
const DIGITS = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?";
export const A_NUMBER = new RegExp(`^${DIGITS}$`);
export const A_DIMENSION = new RegExp(`^(${DIGITS})([a-z%]+)$`, "i");
const A_HEX = /^#[0-9a-f]{3,8}$/i;
/**
 * An identifier, and a `<dashed-ident>` is one.
 *
 * Per css-values-4 a `<dashed-ident>` IS a `<custom-ident>` with the extra restriction that it starts
 * with two dashes — so `--x` is a valid `<custom-ident>` and was reported as not being one. The
 * generator reasons correctly about exactly this production; this matcher did not.
 */
const AN_IDENT = /^--?[a-z_][\w-]*$|^-?[a-z_][\w-]*$/i;
const A_CALL = /^[a-z-]+\(/i;

/**
 * A number with a unit of the RIGHT family, or a bare `0`, or a call.
 *
 * The first version accepted a number with any unit at all, because `units.json` groups units by the
 * spec that defines them rather than by what they are — so `<angle>` accepted `12px`, and the rule
 * that matters most here could not fire. `UNIT_TYPE` is the partition, written down in the generator
 * with an assertion that every unit lands in exactly one family, so a unit CSS adds fails the build
 * until somebody says what it is.
 *
 * A bare `0` is a length and an angle and a time — CSS lets it be dimensionless — and a call is any
 * type at all, because `calc()`, `min()` and `var()` are.
 */
const dimensional = (family: string) => (value: string) => {
  if (value === "0" || A_CALL.test(value)) return true;
  const found = A_DIMENSION.exec(value);
  if (found === null) return false;

  const type = UNIT_TYPE[found[2].toLowerCase()];
  // A unit that is not a unit has no type, and `unknown-unit` owns it — it names the unit, which is
  // the more useful sentence. Two rules on one fault reads as two faults.
  return type === undefined || type === family;
};

const ACCEPTS: Readonly<Record<string, (value: string) => boolean>> = {
  "<length>": dimensional("length"),
  "<percentage>": dimensional("percentage"),
  "<length-percentage>": (value) => dimensional("length")(value) || dimensional("percentage")(value),
  "<angle>": dimensional("angle"),
  "<time>": dimensional("time"),
  "<resolution>": dimensional("resolution"),
  "<number>": (value) => A_NUMBER.test(value) || A_CALL.test(value),
  "<integer>": (value) => /^[+-]?\d+$/.test(value) || A_CALL.test(value),
  "<color>": (value) => A_HEX.test(value) || AN_IDENT.test(value) || A_CALL.test(value),
  "<url>": (value) => A_CALL.test(value),
  "<image>": (value) => A_CALL.test(value) || AN_IDENT.test(value),
  "<custom-ident>": (value) => AN_IDENT.test(value),
};

/**
 * An `initial-value` its own `syntax` does not accept.
 *
 * **Measured in Chromium 151, and the registration does not half-work — it is GONE:**
 *
 * | written | kept? | the name then |
 * |---|---|---|
 * | `syntax: "<color>"; initial-value: #10b981` | yes | refuses junk, falls back to the colour |
 * | `syntax: "<color>"; initial-value: 12px` | **no**, absent from `cssRules` | **accepts any junk** |
 * | `syntax: "<length>"; initial-value: red` | **no** | **accepts any junk** |
 *
 * No interpolation in a transition, no fallback for a value the property cannot parse, and the name
 * back to holding whatever it is handed. Every reason to write `@@property( … )` at all, removed by
 * one mismatched line, and nothing anywhere says so.
 *
 * See {@link ACCEPTS} for why it is matchers, and for the reports deliberately given up.
 */
/**
 * A `@@property` without `syntax` or without `inherits`, which CSS requires.
 *
 * The browser drops such a registration whole and says nothing — the reason `initial-value-and-syntax`
 * exists, one descriptor over. The TYPE requires both, so the editor already says so; the build does
 * not run the type check, and measured, it compiled all three shapes. Reported on `@@property`, the
 * only place a missing thing can be pointed at, and once for both. A descriptor written with a hole
 * counts as written: `hole-in-a-named-block` reports that in its own words.
 */
/** What to write for each descriptor `propertyDescriptorMissing` asks for. */
const WRITE_DESCRIPTOR: Readonly<Record<string, string>> = {
  syntax: '`syntax: "<length>"` — the type it holds, or `"*"` for anything —',
  inherits: "`inherits: false`",
};

export function propertyDescriptorMissing(block: Block, at: string, start: number, findings: Finding[]): void {
  const written = new Set(block.items.flatMap((item) => (item.kind === "declaration" ? [item.property] : [])));
  const missing = ["syntax", "inherits"].filter((one) => !written.has(one));
  if (missing.length === 0) return;

  findings.push({
    rule: "property-descriptor-missing",
    at: start,
    length: `@@${at}`.length,
    message:
      `This \`@@property\` has no ${missing.map((one) => `\`${one}\``).join(" and ")}, and without ` +
      `${missing.length > 1 ? "them" : "it"} the browser drops the whole registration. Add ` +
      missing.map((one) => WRITE_DESCRIPTOR[one]).join(" and ") +
      // Review round 4: following the advice above, with no `initial-value` either, led straight to
      // `initial-value-and-syntax` — so a syntax other than `"*"` is told it needs one here.
      (missing.includes("syntax") && !written.has("initial-value")
        ? ', and an `initial-value` — the value it starts at, which any syntax but `"*"` needs'
        : "") +
      ".",
  });
}

export function initialValueAndSyntax(block: Block, findings: Finding[]): void {
  let syntax: string | undefined;
  let syntaxAt = 0;
  let value: { text: string; at: number } | undefined;
  /** Whether an `initial-value` is written at all, readable or not. */
  let initial = false;

  for (const item of block.items) {
    if (item.kind !== "declaration") continue;
    if (item.property === "initial-value") initial = true;
    // A descriptor written with a hole cannot be read, and a hole is the author's business.
    const text = item.value.every((part) => part.kind === "text")
      ? item.value
          .map((part) => (part.kind === "text" ? part.text : ""))
          .join("")
          .trim()
      : undefined;
    if (text === undefined) continue;

    if (item.property === "syntax") {
      syntax = text.replace(/^["']|["']$/g, "");
      syntaxAt = item.at ?? 0;
    }
    if (item.property === "initial-value") value = { text, at: item.valueAt ?? item.at ?? 0 };
  }

  /**
   * No `initial-value` at all. CSS requires one for every syntax but the universal `"*"`, and the
   * browser drops the registration without it — measured in Chromium, Firefox and WebKit. The type
   * cannot say this, because `"*"` is a string like any other.
   */
  if (syntax !== undefined && syntax !== "*" && !initial) {
    findings.push({
      rule: "initial-value-and-syntax",
      at: syntaxAt,
      length: "syntax".length,
      message:
        `\`syntax: "${syntax}"\` needs an \`initial-value\`, and without one the browser drops the whole ` +
        `registration. Add the value the property starts at, or write \`syntax: "*"\` if it takes anything.`,
    });
    return;
  }

  if (syntax === undefined || value === undefined || syntax === "*") return;

  const components = syntax.split("|").map((one) => one.trim());
  // A multiplier is a LIST, which this does not read; one unknown component silences the whole rule.
  if (components.some((one) => /[+#]$/.test(one) || (one.startsWith("<") && ACCEPTS[one] === undefined))) return;

  const accepted = components.some((one) => (one.startsWith("<") ? ACCEPTS[one](value.text) : one === value.text));
  if (accepted) return;

  findings.push({
    rule: "initial-value-and-syntax",
    at: value.at,
    length: value.text.length,
    message:
      `\`syntax: "${syntax}"\` does not accept \`${value.text}\`, so the browser drops the whole ` +
      `registration, and the name then holds any value at all. Fix whichever of the two is wrong.`,
  });
}

/** Whether `known`'s dash-delimited segments appear, in order, among `parts`. */
function segmentsOf(known: string, parts: readonly string[]): boolean {
  let at = 0;
  for (const part of parts) {
    if (part === known.split("-")[at]) at++;
  }
  return at === known.split("-").length;
}

/**
 * A known feature with characters typed INTO it, which edit distance cannot safely reach.
 *
 * `prefers-reduced-mErrorotion` is six characters from `prefers-reduced-motion`, and `nearest`'s
 * bound is three — raising it is not the fix. Measured on this table: `prefers-reduced-data` is a
 * REAL feature about as far from `prefers-reduced-motion` as that typo is, so any bound wide enough
 * to catch the one reports the other, and the other was new once. Distance cannot tell them apart.
 *
 * Subsequence can. A known name being a subsequence of what was written means somebody typed extra
 * characters into a real name; a genuinely new feature does not contain an old one's letters in
 * order. The length bound keeps a longer relative out — a future `prefers-reduced-motion-strength`
 * is nine longer and stays silent, and this typo is six.
 *
 * **And the length bound was not enough, which a review measured.** `video-` is exactly six, and
 * every `video-`-prefixed feature Media Queries 5 defines is its unprefixed relative with a whole
 * segment in front — so the entire family came back as typos, `min-video-width` as a typo of
 * `min-width` among them. No bound can separate those: the extra text really is six characters.
 *
 * What separates them is WHERE the extra characters are. CSS names a family by adding whole
 * dash-delimited segments — `device-width`, `min-width`, `video-width`, `prefers-reduced-motion` —
 * and a typo does not land on segment boundaries. So the subsequence is asked of the SEGMENTS as
 * well: if the known name's segments are a subsequence of the written name's, this is a relative and
 * nothing is said. `prefers-reduced-mErrorotion` still reports, because its last segment is a typo
 * of a segment rather than an extra one.
 *
 * That is also the safer direction for a feature CSS invents after this list was generated: an
 * unknown feature is `<general-enclosed>`, legal CSS that never matches, and reporting one as a typo
 * is the false report this rule is shaped to avoid.
 */
const INSERTED = 6;

export function typedInto(written: string): string | undefined {
  const parts = written.split("-");

  for (const known of MEDIA_FEATURES) {
    const extra = written.length - known.length;
    if (extra <= 0 || extra > INSERTED) continue;

    // A whole segment added is a family, not a slip — see the note above.
    if (segmentsOf(known, parts)) continue;

    let at = 0;
    for (const character of written) {
      if (character === known[at]) at++;
    }
    if (at === known.length) return known;
  }
  return undefined;
}

export function againstRegisteredSyntax(
  block: Block,
  syntaxes: ReadonlyMap<string, string>,
  findings: Finding[],
): void {
  const walkItems = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      if (item.kind === "rule") {
        walkItems(item.items);
        continue;
      }
      const syntax = syntaxes.get(item.property);
      if (syntax === undefined || syntax === "*") continue;
      if (!item.value.every((part) => part.kind === "text")) continue;

      const value = item.value
        .map((part) => (part.kind === "text" ? part.text : ""))
        .join("")
        .trim();
      /**
       * `!important` is not part of the value, and on a custom property it is ordinary CSS — it is
       * how a variable is made to win. A review measured `{angle}: 90deg !important` reported as a
       * value `<angle>` does not accept, because the flag went into the matcher with the value.
       */
      const written = withoutImportant(value);
      /**
       * A CSS-wide keyword and `var()`, both asked CASE-INSENSITIVELY, because CSS keywords and
       * function names are — css-values-4 §Textual Data Types. `INHERIT` was reported, and the
       * `var(` escape was matched with no `i` while `variableReads` beside it explains at length why
       * it matches `var` case-insensitively. One question, two answers, in one file.
       */
      if (written === "" || GLOBAL.has(written.toLowerCase()) || holdsVar(written)) continue;

      const components = syntax.split("|").map((one) => one.trim());
      if (components.some((one) => /[+#]$/.test(one) || (one.startsWith("<") && ACCEPTS[one] === undefined))) continue;

      const accepted = components.some((one) => (one.startsWith("<") ? ACCEPTS[one](written) : one === written));
      if (accepted) continue;

      findings.push({
        rule: "value-and-registered-syntax",
        at: item.valueAt ?? item.at ?? 0,
        length: value.length,
        message:
          `this property is registered as \`${syntax}\` and does not accept \`${written}\` — measured, the ` +
          `browser keeps the \`initial-value\` instead and says nothing, so the element shows the default.`,
      });
    }
  };
  walkItems(block.items);
}

/**
 * A HOLE inside `@@keyframes( … )` and the other named sites, which have no element to hold one.
 *
 * A hole becomes a custom property ON AN ELEMENT. A named site has none — an animation is applied by
 * whatever names it, a font face by nothing at all — so the value would be read from wherever the
 * rule happened to land. Refused by the build for that reason, and reported here for the same one.
 */
export function holeInANamedBlock(block: Block, at: string, findings: Finding[]): void {
  const walkItems = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      if (item.kind === "rule") {
        walkItems(item.items);
        continue;
      }
      /**
       * **Over the HOLE, and every one of them.**
       *
       * This pointed at the start of the VALUE with a length of 1 — measured on
       * `@@font-face( src: url($(n)); )`, a one-character squiggle over the `u` of `url(`, which is
       * mid-word and is not the fault. And it stopped after the first hole, so an author fixed one,
       * re-ran, and met the next.
       *
       * `HolePart` carries `at` and `length` and its own note says why: *"for a squiggle over the
       * hole itself … what lets a rule about a hole's POSITION point at the hole rather than at the
       * declaration holding it."* `hole-as-a-custom-property-name` reads it; this did not.
       *
       * One finding per HOLE rather than per declaration, because each is a separate thing to
       * remove — `src: url({a}) format({b})` is two edits.
       */
      for (const hole of item.value) {
        if (hole.kind !== "hole") continue;
        findings.push({
          rule: "hole-in-a-named-block",
          at: hole.at ?? item.valueAt ?? item.at ?? 0,
          length: hole.length ?? 1,
          message:
            `a hole cannot go in \`@@${at}( … )\` — this names something the whole stylesheet uses, ` +
            `and there is no element here for a value to come from. Declare the value with ` +
            `\`@@property( … )\`, read it as \`var($(name))\` inside this site, and set it on the ` +
            `element that uses it.`,
        });
      }
    }
  };
  walkItems(block.items);
}

/**
 * `when` or a spread inside `@@keyframes( … )` and the other named blocks.
 *
 * Composition decides what lands on an ELEMENT: a guard switches a map on and off, a spread merges
 * one into another. A named block is not an element — it is a rule the whole stylesheet uses — so
 * neither has anything to act on.
 *
 * **Both were reported as something else.** `when $(on) { from { … } }` came back as *`if ( 0 )`
 * is not a keyframe*, which names the guard as a frame; and the virtual file wrote the helper call
 * among the object literal's members, where a call is not a member, so the file did not parse and
 * nothing else in it was checked either.
 */
export function compositionInANamedBlock(block: Block, at: string, findings: Finding[]): void {
  const walkItems = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      const found =
        item.kind === "rule" ? branchOf(item.prelude) !== undefined : holeIn(item.property, SPREAD) !== undefined;

      if (found) {
        findings.push({
          rule: "composition-in-a-named-block",
          at: item.at ?? 0,
          length: item.kind === "rule" ? item.prelude.length : item.property.length,
          message:
            `\`@@${at}( … )\` cannot hold ${item.kind === "rule" ? "`when`" : "a spread"} — composition ` +
            `decides what lands on an ELEMENT, and this names a rule the whole stylesheet uses. ` +
            `Compose where the block is used instead.`,
        });
        return;
      }
      if (item.kind === "rule") walkItems(item.items);
    }
  };
  walkItems(block.items);
}
