import { PROPERTY_GRAMMAR, TYPE_GRAMMAR } from "./grammars.generated";
import { UNIT_TYPE } from "./keywords.generated";
import { matchValue } from "./matchValue";
import { remember } from "./remember";
import { withoutImportant } from "./rules/shared";
import { parseValueSyntax, type Term } from "./valueSyntax";

/**
 * Whether a value is one its property's grammar can read — function arguments included.
 *
 * ## Why
 *
 * `check-engine-sweep.mjs` found the shape every other value rule misses: a fault INSIDE a call or
 * between tokens no single word gives away — `rgb(1x 2 3)`, `linear-gradient(redx, blue)`,
 * `cubic-bezier(0.4 0, 0.2, 1)`, `aspect-ratio: 16  9`. Each is dropped by all three engines. The
 * grammar `mdn-data` publishes for each property says so, read with `matchValue` and a word for each
 * of CSS's own types.
 *
 * ## Measured before it was written
 *
 * A prototype over 1946 real declarations — jsdom's user-agent sheet, three applications' CSS and
 * this repository's — each asked of Chromium, Firefox and WebKit: 1618 agreed, ONE was refused that
 * an engine accepts (`vertical-align: center`, Firefox's alone), 326 could not be read (`var()`,
 * which only the page resolves). It caught 59 of the 65 holes the sweep had left. Getting there took
 * three fixes to `matchValue` and one to `mdn-data` — see {@link CORRECTIONS}.
 *
 * `check-value-grammar.mjs` keeps it there: every declaration in its corpus that an engine accepts
 * must be read here, or the gate fails.
 *
 * ## What it does not answer
 *
 * `undefined` is "cannot say", and it is the answer for a `var()`, `env()` or `attr()` anywhere in
 * the value, a property with no grammar, and a value whose reading runs past a fixed budget. A math
 * function stands for any number, length, angle or the like, unread inside.
 */

/**
 * Where `mdn-data` is wrong, each with the measurement that proved it.
 *
 * - `circle()`: `mdn-data` gives it `<radial-size>`, which it shares with `radial-gradient()`, where
 *   one percentage is not allowed. `clip-path: circle(50%)` is accepted by Chromium, Firefox and
 *   WebKit (the sweep's own base case). The shape's radius is CSS Shapes 1's `<shape-radius>`.
 */
const CORRECTIONS: Readonly<Record<string, string>> = {
  "circle()": "circle( <shape-radius>? [ at <position> ]? )",
  "shape-radius": "<length-percentage> | closest-side | farthest-side",
  // `mdn-data`: `<string> | <custom-ident>+`. Measured in all three engines: a name of several words
  // is refused when its FIRST is a complete generic family — `system-ui sans-serif`, `serif Neue` —
  // and taken when a generic word comes later (`My serif`) or is an incomplete one (`ui-monospace Mono`).
  "family-name": "<string> | <family-name-start> <custom-ident>*",
  // `mdn-data`: `<string>`. Measured in all three engines: an OpenType tag is exactly four ASCII
  // characters — `"lig"`, `"ligax"` and `"liĝa"` are refused, `"li a"` is taken.
  "feature-tag-value": "<opentype-tag> [ <integer> | on | off ]?",
};

/** A property whose own grammar `mdn-data` writes wrong, with the same measurements as above. */
const PROPERTY_CORRECTIONS: Readonly<Record<string, string>> = {
  "font-variation-settings": "normal | [ <opentype-tag> <number> ]#",
};

/** The complete generic families, which may not begin a family name of several words. */
const GENERIC_COMPLETE = new Set(["serif", "sans-serif", "system-ui", "cursive", "fantasy", "math", "monospace"]);

const GRAMMAR = (name: string): string | undefined => CORRECTIONS[name] ?? TYPE_GRAMMAR[name];
const propertyGrammar = (name: string): string | undefined => PROPERTY_CORRECTIONS[name] ?? PROPERTY_GRAMMAR[name];

const parsed = new Map<string, Term | null>();
function grammar(source: string): Term | null {
  let term = parsed.get(source);
  if (term === undefined) {
    try {
      term = parseValueSyntax(source);
    } catch {
      term = null;
    }
    parsed.set(source, term);
  }
  return term;
}

/** Tokens: a call and a string each whole, `,` `/` `[` `]` on their own. `undefined` for an unbalanced one. */
export function tokensOfValue(value: string): string[] | undefined {
  const out: string[] = [];
  let current = "";
  const flush = (): void => {
    if (current !== "") out.push(current);
    current = "";
  };
  for (let index = 0; index < value.length; ) {
    const one = value[index];
    if (one === '"' || one === "'") {
      const end = endOfString(value, index);
      if (end === -1) return undefined;
      current += value.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (one === "(") {
      let depth = 1;
      let at = index + 1;
      while (at < value.length && depth > 0) {
        const code = value[at];
        if (code === "(") depth++;
        else if (code === ")") depth--;
        else if (code === '"' || code === "'") {
          at = endOfString(value, at);
          if (at === -1) return undefined;
        }
        at++;
      }
      if (depth !== 0) return undefined;
      current += value.slice(index, at);
      index = at;
      continue;
    }
    if (one === ")") return undefined;
    if (/\s/.test(one)) {
      flush();
      index++;
      continue;
    }
    // `[` and `]` are tokens of their own: grid line names, `[top] 20px [mid]`, are written that way.
    if (one === "," || one === "/" || one === "[" || one === "]") {
      flush();
      out.push(one);
      index++;
      continue;
    }
    current += one;
    index++;
  }
  flush();
  return out;
}

/** Where a string that opens at `start` closes, a backslash escaping the next character. -1 if it never does. */
function endOfString(value: string, start: number): number {
  for (let at = start + 1; at < value.length; at++) {
    if (value[at] === "\\") at++;
    else if (value[at] === value[start]) return at;
  }
  return -1;
}

const NUMBER_TEXT = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const A_NUMBER = new RegExp(`^${NUMBER_TEXT}$`);
const A_DIMENSION = new RegExp(`^(${NUMBER_TEXT})([a-zA-Z%]+)$`);
const A_CALL = /^([a-zA-Z-][\w-]*)\((.*)\)$/s;
/** A math function stands for a number of any kind; what is inside it is not read here. */
const MATH = new Set([
  "calc",
  "min",
  "max",
  "clamp",
  "round",
  "mod",
  "rem",
  "abs",
  "sign",
  "sqrt",
  "pow",
  "hypot",
  "log",
  "exp",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "progress",
  "sibling-index",
  "sibling-count",
  "random",
  "calc-size",
]);
const NUMERIC = new Set([
  "length",
  "percentage",
  "number",
  "integer",
  "angle",
  "time",
  "resolution",
  "frequency",
  "flex",
  "length-percentage",
  "angle-percentage",
  "time-percentage",
  "frequency-percentage",
  "dimension",
  "zero",
]);
const WIDE = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

function kindOf(token: string): string | undefined {
  const found = A_DIMENSION.exec(token);
  if (found === null) return undefined;
  return found[2] === "%" ? "percentage" : UNIT_TYPE[found[2].toLowerCase()];
}

/** What a math expression is: its kind (`null` for a plain number), or `false` for none at all. */
type MathType = string | null | false;

/** The four math functions read here; any other stands for a number of any kind, unread. */
const READ_MATH = new Set(["calc", "min", "max", "clamp"]);
const CONSTANTS = new Set(["e", "pi", "infinity", "-infinity", "nan"]);

/**
 * The type of a math function's arithmetic — `calc(100 - 2rem)` is a number minus a length, which is
 * no type at all. `percentage` is what a `%` resolves to where it is used: `length` in `width`.
 * `undefined` is "cannot say" — a function this does not read, a word it does not know.
 *
 * Measured in Chromium, Firefox and WebKit before it was written: a length divided by a length is a
 * number in Chromium and WebKit (`line-height: calc(10px / 2px)`), so it is read as one; `+` and `-`
 * need a space each side (`calc(1px+2px)` is dropped by all three); two lengths multiplied are none.
 */
function mathType(call: string, inner: string, percentage: string | null): MathType | undefined {
  const name = call.toLowerCase();
  if (!READ_MATH.has(name)) return undefined;
  const args = splitTopLevel(inner, ",");
  if (args === undefined) return undefined;
  if (name === "calc" && args.length !== 1) return false;
  if (name === "clamp" && args.length !== 3) return false;
  let kind: MathType | undefined;
  for (const one of args) {
    const found = sumType(one.trim(), percentage);
    if (found === undefined) return undefined;
    if (found === false) return false;
    if (kind === undefined) kind = found;
    else if (kind !== found) return false;
  }
  return kind;
}

/** Text split on a separator outside every bracket. `undefined` when the brackets do not balance. */
function splitTopLevel(text: string, separator: string): string[] | undefined {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < text.length; at++) {
    if (text[at] === "(") depth++;
    else if (text[at] === ")") depth--;
    else if (depth === 0 && text[at] === separator) {
      out.push(text.slice(from, at));
      from = at + 1;
    }
    if (depth < 0) return undefined;
  }
  if (depth !== 0) return undefined;
  out.push(text.slice(from));
  return out;
}

/** `a + b - c`, each operator with a space on both sides, each term of one kind. */
function sumType(text: string, percentage: string | null): MathType | undefined {
  const terms: string[] = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < text.length; at++) {
    const one = text[at];
    if (one === "(") depth++;
    else if (one === ")") depth--;
    else if (
      depth === 0 &&
      (one === "+" || one === "-") &&
      /\s/.test(text[at - 1] ?? "") &&
      /\s/.test(text[at + 1] ?? "")
    ) {
      terms.push(text.slice(from, at));
      from = at + 1;
    }
  }
  terms.push(text.slice(from));
  let kind: MathType | undefined;
  for (const one of terms) {
    const found = productType(one.trim(), percentage);
    if (found === undefined) return undefined;
    if (found === false) return false;
    if (kind === undefined) kind = found;
    else if (kind !== found) return false;
  }
  return kind;
}

/** `a * b / c`, where at most one factor of a product is not a number. */
function productType(text: string, percentage: string | null): MathType | undefined {
  if (text === "") return false;
  const factors: { factor: string; divides: boolean }[] = [];
  let depth = 0;
  let from = 0;
  let divides = false;
  for (let at = 0; at < text.length; at++) {
    const one = text[at];
    if (one === "(") depth++;
    else if (one === ")") depth--;
    else if (depth === 0 && (one === "*" || one === "/")) {
      factors.push({ factor: text.slice(from, at).trim(), divides });
      divides = one === "/";
      from = at + 1;
    }
  }
  factors.push({ factor: text.slice(from).trim(), divides });
  let kind: MathType | undefined = null;
  for (const { factor, divides: by } of factors) {
    const found = valueType(factor, percentage);
    if (found === undefined) return undefined;
    if (found === false) return false;
    if (by) {
      if (found === null) continue;
      // A kind divided by the same kind is a number — Chromium and WebKit, measured.
      if (found === kind) kind = null;
      else return false;
      continue;
    }
    if (kind === null) kind = found;
    else if (found !== null) return false;
  }
  return kind;
}

/** One value inside the arithmetic: a number, a dimension, a bracketed sum, a call, a constant. */
function valueType(text: string, percentage: string | null): MathType | undefined {
  if (text === "") return false;
  if (A_NUMBER.test(text)) return null;
  if (CONSTANTS.has(text.toLowerCase())) return null;
  const dimension = A_DIMENSION.exec(text);
  if (dimension !== null) {
    if (dimension[2] === "%") return percentage ?? "percentage";
    return UNIT_TYPE[dimension[2].toLowerCase()] ?? false;
  }
  if (text.startsWith("(") && text.endsWith(")")) return sumType(text.slice(1, -1).trim(), percentage);
  const call = A_CALL.exec(text);
  if (call !== null) return mathType(call[1], call[2], percentage);
  // Two values with nothing between them — `100% 40rem`, or `1px+2px`, which CSS reads as `1px` and
  // `+2px` — and otherwise a word this does not know.
  if (/\s/.test(text) || /^[+-]?[\d.]/.test(text)) return false;
  return undefined;
}

/** What kind a numeric type's math must come to, and what a `%` inside it resolves to. */
const MATH_CONTEXT: Readonly<Record<string, readonly [MathType, string | null]>> = {
  length: ["length", null],
  "length-percentage": ["length", "length"],
  percentage: ["percentage", null],
  number: [null, null],
  integer: [null, null],
  angle: ["angle", null],
  "angle-percentage": ["angle", "angle"],
  time: ["time", null],
  "time-percentage": ["time", "time"],
  frequency: ["frequency", null],
  "frequency-percentage": ["frequency", "frequency"],
  resolution: ["resolution", null],
  flex: ["flex", null],
  // `<zero>` beside `<angle>` in `rotate()`: math there has to come to a number, as `0` is one.
  zero: [null, null],
};

/** A type CSS itself defines, answered here. `undefined` for one whose grammar is in the table. */
function primitive(name: string, token: string): boolean | undefined {
  const call = A_CALL.exec(token);
  if (call !== null && NUMERIC.has(name) && MATH.has(call[1].toLowerCase())) {
    const context = MATH_CONTEXT[name];
    if (context === undefined) return true;
    const kind = mathType(call[1], call[2], context[1]);
    return kind === undefined || kind === context[0];
  }
  switch (name) {
    case "length-percentage":
      return token === "0" || kindOf(token) === "length" || kindOf(token) === "percentage";
    case "angle-percentage":
      return token === "0" || kindOf(token) === "angle" || kindOf(token) === "percentage";
    case "time-percentage":
    case "frequency-percentage":
      return kindOf(token) === name.split("-")[0] || kindOf(token) === "percentage";
    case "length":
      return token === "0" || kindOf(token) === "length";
    case "percentage":
      return kindOf(token) === "percentage";
    case "number":
      return A_NUMBER.test(token);
    case "integer":
      return /^[+-]?\d+$/.test(token);
    case "zero":
      return token === "0";
    case "angle":
      return token === "0" || kindOf(token) === "angle";
    case "time":
    case "resolution":
    case "frequency":
    case "flex":
      return kindOf(token) === name;
    case "dimension":
      return A_DIMENSION.test(token);
    case "string":
      return /^(?:"[^]*"|'[^]*')$/.test(token);
    case "opentype-tag":
      return /^(["'])[\x20-\x7e]{4}\1$/.test(token);
    case "family-name-start":
      // A CSS-wide word is taken here by all three (`inherit Arial`), so it is not refused.
      return /^-{0,2}[a-zA-Z_][\w-]*$/.test(token) && !GENERIC_COMPLETE.has(token.toLowerCase());
    case "ident":
    case "custom-ident":
      // `--brand` is a custom-ident too: `transition-property: --brand` is accepted by every engine.
      return /^-{0,2}[a-zA-Z_][\w-]*$/.test(token) && !WIDE.has(token.toLowerCase());
    case "dashed-ident":
    case "custom-property-name":
      return /^--[\w-]+$/.test(token);
    case "url":
      return (call !== null && ["url", "src"].includes(call[1].toLowerCase())) || /^(?:"[^]*"|'[^]*')$/.test(token);
    case "hex-color":
      return /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(token);
    case "declaration-value":
    case "any-value":
      return true;
    default:
      return undefined;
  }
}

/** A reference to a type or a property, replaced by its grammar and carrying its own multiplier. */
function expand(term: Term, depth = 0): Term {
  if (term.kind === "data" || term.kind === "property") {
    if (term.kind === "data" && primitive(term.name ?? "", "") !== undefined) return term;
    const source = term.kind === "property" ? propertyGrammar(term.name ?? "") : GRAMMAR(term.name ?? "");
    const inner = source === undefined || depth > 12 ? null : grammar(source);
    // A type with no grammar is not refused: reading it as anything is the answer that cannot be wrong.
    if (inner === null) return { ...term, kind: "data", name: "any-value" };
    return expand(
      { kind: "seq", terms: [inner], optional: term.optional, repeat: term.repeat, comma: term.comma },
      depth + 1,
    );
  }
  if (term.terms === undefined || term.kind === "function") return term;
  return { ...term, terms: term.terms.map((one) => expand(one, depth)) };
}

const expandedOf = new Map<Term, Term>();
function expanded(term: Term): Term {
  let out = expandedOf.get(term);
  if (out === undefined) {
    out = expand(term);
    expandedOf.set(term, out);
  }
  return out;
}

const argumentsOf = new Map<Term, Term>();

/**
 * Each read costs one; a reading that would run past this is answered "cannot say".
 *
 * Measured in review: at 200,000 a `background` of twenty layers took 608 ms to come back "cannot
 * say", and the editor asks on every keystroke. At 10,000 the corpus loses two readings of 1754 and
 * the worst value is tens of milliseconds — see the test beside `invalid-value`.
 */
let budget = 0;
class OverBudget extends Error {}

function accepts(term: Term, token: string): boolean {
  if (--budget < 0) throw new OverBudget();
  switch (term.kind) {
    case "keyword":
      return token.toLowerCase() === (term.name ?? "").toLowerCase();
    case "literal":
      return token === term.name;
    case "data":
      return primitive(term.name ?? "", token) ?? true;
    case "function": {
      const call = A_CALL.exec(token);
      if (call === null || call[1].toLowerCase() !== (term.name ?? "").toLowerCase()) return false;
      const args = tokensOfValue(call[2]);
      if (args === undefined) return false;
      if ((term.terms ?? []).length === 0) return args.length === 0;
      let inner = argumentsOf.get(term);
      if (inner === undefined) {
        inner = expand({ kind: "seq", terms: term.terms ?? [] });
        argumentsOf.set(term, inner);
      }
      return matchValue(inner, args, accepts) !== undefined;
    }
    default:
      return false;
  }
}

/**
 * `true` it reads, `false` it does not, `undefined` this cannot say — remembered per property and
 * value, because a project writes the same declaration in file after file and an editor asks again on
 * every keystroke. Measured by `bench-css.mjs`: `background: red` costs half a millisecond, and without
 * this a 1000-file build went from 2.3 to 16 ms a file.
 */
export const valueMatchesGrammar: (property: string, value: string) => boolean | undefined = remember(
  10_000,
  readAgainstGrammar,
);

function readAgainstGrammar(property: string, value: string): boolean | undefined {
  // `withoutImportant`, not a pattern: `\s*!\s*important\s*$` was quadratic in a run of spaces.
  const bare = withoutImportant(value).trim();
  if (bare === "" || /\b(?:var|env|attr)\(/i.test(bare)) return undefined;
  const source = propertyGrammar(property.toLowerCase());
  if (source === undefined) return undefined;
  if (WIDE.has(bare.toLowerCase())) return true;
  // An unbalanced bracket or quote is `unclosed-call`'s to name; read wrong here, it would be said twice.
  const tokens = tokensOfValue(bare);
  if (tokens === undefined) return undefined;
  const top = grammar(source);
  if (top === null) return undefined;
  budget = 10_000;
  try {
    return matchValue(expanded(top), tokens, accepts) !== undefined;
  } catch (error) {
    if (error instanceof OverBudget) return undefined;
    throw error;
  }
}

/**
 * Every keyword a property's grammar reaches, function arguments included — `background` reaches
 * `red` through `<color>` and `repeat-x` through `<repeat-style>`. Asked by `supports-never-true`,
 * which reports a word one letter from one of these and lets any other word be the question.
 */
export const keywordsOf: (property: string) => ReadonlySet<string> = remember(2_000, (property: string) => {
  const found = new Set<string>();
  const seen = new Set<Term>();
  const walk = (term: Term): void => {
    if (seen.has(term)) return;
    seen.add(term);
    if (term.kind === "keyword" && term.name !== undefined) found.add(term.name.toLowerCase());
    if (term.kind === "function") {
      found.add(`${(term.name ?? "").toLowerCase()}(`);
      if ((term.terms ?? []).length > 0) walk(expand({ kind: "seq", terms: term.terms ?? [] }));
      return;
    }
    for (const one of term.terms ?? []) walk(one);
  };
  const source = propertyGrammar(property.toLowerCase());
  const top = source === undefined ? null : grammar(source);
  if (top !== null) walk(expanded(top));
  return found;
});
