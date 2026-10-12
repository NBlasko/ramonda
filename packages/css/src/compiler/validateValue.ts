import { PROPERTY_GRAMMAR, TYPE_GRAMMAR } from "./grammars.generated";
import { UNIT_TYPE } from "./keywords.generated";
import { matchValue } from "./matchValue";
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
};

const GRAMMAR = (name: string): string | undefined => CORRECTIONS[name] ?? TYPE_GRAMMAR[name];

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
  "dimension",
  "zero",
]);
const WIDE = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

function kindOf(token: string): string | undefined {
  const found = A_DIMENSION.exec(token);
  if (found === null) return undefined;
  return found[2] === "%" ? "percentage" : UNIT_TYPE[found[2].toLowerCase()];
}

/** A type CSS itself defines, answered here. `undefined` for one whose grammar is in the table. */
function primitive(name: string, token: string): boolean | undefined {
  const call = A_CALL.exec(token);
  if (call !== null && NUMERIC.has(name) && MATH.has(call[1].toLowerCase())) return true;
  switch (name) {
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
    const source = term.kind === "property" ? PROPERTY_GRAMMAR[term.name ?? ""] : GRAMMAR(term.name ?? "");
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

/** Each read costs one; a reading that would run past this is answered "cannot say". */
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

/** `true` it reads, `false` it does not, `undefined` this cannot say. */
export function valueMatchesGrammar(property: string, value: string): boolean | undefined {
  const bare = value.replace(/\s*!\s*important\s*$/i, "").trim();
  if (bare === "" || /\b(?:var|env|attr)\(/i.test(bare)) return undefined;
  const source = PROPERTY_GRAMMAR[property.toLowerCase()];
  if (source === undefined) return undefined;
  if (WIDE.has(bare.toLowerCase())) return true;
  // An unbalanced bracket or quote is `unclosed-call`'s to name; read wrong here, it would be said twice.
  const tokens = tokensOfValue(bare);
  if (tokens === undefined) return undefined;
  const top = grammar(source);
  if (top === null) return undefined;
  budget = 200_000;
  try {
    return matchValue(expanded(top), tokens, accepts) !== undefined;
  } catch (error) {
    if (error instanceof OverBudget) return undefined;
    throw error;
  }
}
