import type { Block, BlockItem, Declaration, ValuePart } from "./ast";
import { holeOutOfPlace } from "./errors";
import { KEYWORDS, PROPERTIES } from "./keywords.generated";
import type { BlockSite } from "./scan";

/**
 * The CSS checker: the faults the type map deliberately cannot catch.
 *
 * ## What is left to it, and every boundary was measured
 *
 * Each candidate was put through the real type check before a rule was written for it, so nothing
 * here repeats a diagnostic somebody already gets:
 *
 * | written | the types | here |
 * |---|---|---|
 * | `dsiplay: flex` | `TS2561`, **with** *did you mean* | — |
 * | `flex-dirction: row` | `TS2353`, **no suggestion** | `unknown-property` |
 * | `position: statik` | `TS2820`, with *did you mean* | — |
 * | `display: flexx` | **silent** | `unknown-value` |
 * | `border-left: 4px sollid red` | **silent** | `unknown-value` |
 * | `color: red; color: red` | **silent** | `repeated-declaration` |
 *
 * A bare property name is left to the types because they say it better. A dashed one is not, and the
 * reason is one character wide: a QUOTED object key gets no suggestion from TypeScript, and a dashed
 * name cannot be written unquoted.
 *
 * ## It may not import `@ramonda/check`
 *
 * The technique is shared; the code is not. A rule here reads a parsed `Block`, not a `ts.Program` —
 * there is no value to follow, no declaration to resolve, and nothing the other package's machinery
 * would help with.
 */

/** One thing worth saying about a block. */
export interface Finding {
  /** The rule's id, which is what a reader searches for. */
  readonly rule: RuleId;
  /** The author's own offset — of the FAULT, not of the block that holds it. */
  readonly at: number;
  /**
   * How much of the author's text the fault covers.
   *
   * An editor draws a squiggle from this, and a zero-width one is a mark nobody can see. It is the
   * offending text itself — the property name, the word in the value — never the whole declaration.
   */
  readonly length: number;
  /** What is wrong and what to write instead, in one sentence. */
  readonly message: string;
}

export type RuleId =
  | "unknown-property"
  | "unknown-value"
  | "repeated-declaration"
  | "hole-out-of-place"
  | "uncolourable-block"
  | "run-on-declaration";

/** Accepted by every property, whatever else it accepts. */
const GLOBAL = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

/** The same list as a set, for the "does this exist" question rather than the "what was meant" one. */
const KNOWN = new Set(PROPERTIES);

/**
 * What an editor will not colour, which is the one thing here a BUILD has no business failing over.
 *
 * An editor stops consulting syntax injections the moment it enters a tag's attribute list, so a
 * bare `css=@( … )` is coloured only as the FIRST attribute on the tag name's own line. Written
 * anywhere else it compiles, is checked, and looks like an error — with nothing on the screen to say
 * why, because what failed is a grammar nobody can see.
 *
 * So it is reported where it can be acted on and nowhere else: the editor plugin draws it as a
 * SUGGESTION. `checkBlock`'s findings stop a build; this one must not, because nothing is wrong.
 */
export function checkSite(source: string, site: BlockSite): Finding[] {
  if (!site.wrap || firstOnTheTagLine(source, site.start)) return [];

  return [
    {
      rule: "uncolourable-block",
      at: site.start,
      length: site.name.length,
      message:
        `an editor colours a bare block only as the first attribute on the tag name's own line — ` +
        `write it as \`${site.name}={@( … )}\`, which is the same value and is coloured anywhere.`,
    },
  ];
}

/**
 * Whether the name at `start` follows the tag's own name with nothing but spaces between.
 *
 * A newline is enough to lose the colours, which is why this is not `isAttribute` with a flag: that
 * one walks over attributes and line breaks to prove the site is in a tag at all, and here both of
 * those are the answer NO.
 */
function firstOnTheTagLine(source: string, start: number): boolean {
  let index = start - 1;
  while (index >= 0 && (source.charCodeAt(index) === 32 || source.charCodeAt(index) === 9)) index--;

  const end = index + 1;
  while (index >= 0 && isTagNameCharacter(source.charCodeAt(index))) index--;

  return index >= 0 && end > index + 1 && source.charCodeAt(index) === 60; /* < */
}

/** A tag name: an identifier, plus the `.` of a member expression and the `-` of a custom element. */
function isTagNameCharacter(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 95 ||
    code === 36 ||
    code === 45 ||
    code === 46
  );
}

export function checkBlock(block: Block): Finding[] {
  const findings: Finding[] = [];
  walk(block.items, findings);
  return findings.sort((a, b) => a.at - b.at);
}

function walk(items: readonly BlockItem[], findings: Finding[]): void {
  /** What each property was last declared as, for `repeated-declaration`. Per rule, not per block. */
  const seen = new Map<string, string>();

  for (const item of items) {
    if (item.kind === "rule") {
      holeInHead(item.prelude, item.at, "a selector", findings);
      // A nested rule has its own scope: `color` beside it and `color` inside it are two
      // declarations on two different elements, and neither repeats the other.
      walk(item.items, findings);
      continue;
    }

    /**
     * A hole read into the PROPERTY, which is what a forgiving parse does with one written where a
     * custom property cannot go. `{{name}}: 24px` puts it in the name; a hole standing alone with no
     * colon after it puts the whole declaration there.
     */
    holeInHead(item.property, item.at, item.value.length === 0 ? "a declaration" : "a property name", findings);
    unknownProperty(item, findings);
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
    if (findings.length === before) unknownValue(item, findings);
    repeated(item, seen, findings);
  }
}

/* ── the rules ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Two declarations run together, which is what a missing `;` makes of them.
 *
 * **Nothing else reports it, and that had to be measured.** `padding: 4px 0 border-left: 1px solid
 * red` is one value to the parser, and `padding` is not among the 123 properties whose values are a
 * closed union — so the type layer has no grounds and `unknown-value` has nothing to check against.
 * The browser drops both declarations and the page renders without the style, silently, which is the
 * whole reason this exists.
 *
 * **A colon inside a value is the tell.** CSS values do not contain bare colons; the three places one
 * legitimately appears — inside a string, inside `url( … )`, inside any other function — are exactly
 * where this does not look. A hole is skipped too: what is inside one is TypeScript, and a colon
 * there is a type annotation or a conditional.
 */
function runOn(declaration: Declaration, findings: Finding[]): void {
  for (const part of declaration.value) {
    if (part.kind !== "text" || part.at === undefined) continue;

    const at = bareColon(part.text);
    if (at === -1) continue;

    /** The name the colon belongs to, which is the declaration that was swallowed. */
    let start = at;
    while (start > 0 && isNameCharacter(part.text.charCodeAt(start - 1))) start--;
    const name = part.text.slice(start, at);
    if (name === "") continue;

    findings.push({
      rule: "run-on-declaration",
      at: part.at + start,
      length: name.length,
      message:
        `\`${name}\` is being read as part of \`${declaration.property}\`'s value — ` +
        `the declaration before it has no \`;\`, so the browser drops both.`,
    });
    return;
  }
}

/** The first colon that is not inside a string or a function, or -1. */
function bareColon(text: string): number {
  let depth = 0;
  let quote = 0;

  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);

    if (quote !== 0) {
      if (code === 92 /* \ */) index++;
      else if (code === quote) quote = 0;
      continue;
    }

    if (code === 34 /* " */ || code === 39 /* ' */) quote = code;
    else if (code === 40 /* ( */) depth++;
    else if (code === 41 /* ) */) depth = Math.max(0, depth - 1);
    else if (code === 58 /* : */ && depth === 0) return index;
  }

  return -1;
}

/** A CSS property name's characters, which is what stands before the colon that gave it away. */
function isNameCharacter(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 45 ||
    code === 95
  );
}

/**
 * A dashed property name that is nearly one CSS has.
 *
 * **Bare names are left to the types**, which report them with TypeScript's own *did you mean*. A
 * dashed one cannot be an unquoted object key, and a quoted key gets no suggestion — measured. So
 * this fills exactly that hole and nothing else.
 *
 * A name with no near miss is not reported either: the types already said it does not exist, and
 * repeating that with nothing added is noise.
 */
function unknownProperty(item: Declaration, findings: Finding[]): void {
  const name = item.property;
  if (item.at === undefined) return;
  // A custom property is the author's, and a vendor-prefixed name is a browser's — neither is in
  // CSS's own list and neither is a typo of anything in it.
  if (name.startsWith("-") || !name.includes("-")) return;
  if (KNOWN.has(name)) return;

  const meant = nearest(name, PROPERTIES);
  if (meant === undefined) return;

  findings.push({
    rule: "unknown-property",
    at: item.at,
    length: name.length,
    message: `\`${name}\` is not a CSS property. Did you mean \`${meant}\`?`,
  });
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
function unknownValue(item: Declaration, findings: Finding[]): void {
  const accepted = KEYWORDS[item.property];
  if (accepted === undefined) return;

  // An EMPTY row is a property that accepts no keyword at all — see the generator. Splitting `""`
  // would give a set holding one empty string, which matches nothing and reads as a bug later.
  const keywords = new Set(accepted === "" ? [] : accepted.split(" "));

  for (const word of words(item.value)) {
    if (keywords.has(word.text) || GLOBAL.has(word.text)) continue;

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
}

/**
 * The same property declared twice with the SAME value, which says nothing either way.
 *
 * **Only when the value matches, and that narrowing is the whole rule.** Two declarations of one
 * property with DIFFERENT values is a deliberate idiom — a fallback for an engine that will drop the
 * second, `width: 100px; width: fit-content;`. Reporting it would be reporting a technique, which is
 * how a checker earns being switched off.
 */
function repeated(item: Declaration, seen: Map<string, string>, findings: Finding[]): void {
  // A hole makes two declarations different whatever the text says: the values are decided at
  // render, and nothing here knows they will agree.
  if (item.value.some((part) => part.kind === "hole")) {
    seen.delete(item.property);
    return;
  }

  const value = item.value
    .map((part) => (part.kind === "text" ? part.text : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  if (seen.get(item.property) === value && item.at !== undefined) {
    findings.push({
      rule: "repeated-declaration",
      at: item.at,
      length: item.property.length,
      message: `\`${item.property}\` is already set to \`${value}\` in this block. The first one can never apply.`,
    });
  }

  seen.set(item.property, value);
}

/**
 * A hole where a custom property cannot go: a property name, a selector, a whole declaration.
 *
 * The build refuses these outright — a custom property holds a VALUE, so there is no correct
 * compilation — and this exists to say it FIRST, in an editor, while it is being typed rather than
 * at the end of a build. It is reachable only from a forgiving parse, which is what an editor uses.
 */
function holeInHead(
  text: string,
  at: number | undefined,
  what: "a declaration" | "a property name" | "a selector",
  findings: Finding[],
): void {
  const found = text.indexOf("{{");
  if (found === -1 || at === undefined) return;

  // The `{{`, which is where the author has to move something. The expression's own length is not
  // the fault and underlining it would say the expression is wrong.
  findings.push({ rule: "hole-out-of-place", at: at + found, length: 2, message: holeOutOfPlace(what) });
}

/* ── reading a value ───────────────────────────────────────────────────────────────────────── */

interface Word {
  readonly text: string;
  readonly at: number | undefined;
}

/**
 * The bare identifiers in a value, and nothing else.
 *
 * Everything skipped here is something no keyword table could judge, and each was a false report
 * before it was skipped: a string's contents (`content: "flexx"`), a function's name and arguments
 * (`rgb(0 0 0)`, `var(--x, flex)`), a number or a length, a hex colour, and `!important`.
 *
 * A hole contributes nothing at all — its value is decided at render, and this is a build-time read.
 */
function words(parts: readonly ValuePart[]): Word[] {
  const out: Word[] = [];

  for (const [position, part] of parts.entries()) {
    if (part.kind !== "text") continue;
    const text = part.text;

    /**
     * A word TOUCHING a hole is part of the hole's value, not a value of its own.
     *
     * `padding: {{n}}px` is one length written in two pieces, and `px` on its own is nothing a
     * property accepts. Measured before this existed, on every property with a keyword row:
     * `gap: {{n}}px` reported *`gap` does not accept `px`* — a false report on correct CSS, which is
     * how a checker earns being switched off. Whitespace is what separates values, so a piece with
     * none between it and the hole is the same value.
     */
    const glued = {
      before: position > 0 && parts[position - 1].kind === "hole" && !isSpace(text.charCodeAt(0)),
      after:
        position + 1 < parts.length &&
        parts[position + 1].kind === "hole" &&
        !isSpace(text.charCodeAt(text.length - 1)),
    };
    const first = out.length;

    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);

      if (code === 34 || code === 39) {
        index = endOfString(text, index);
        continue;
      }
      if (code === 33 /* ! */) {
        // `!important`, and anything else in that position is not a value word either.
        while (index < text.length && !isSpace(text.charCodeAt(index))) index++;
        continue;
      }
      if (code === 35 /* # */ || (code >= 48 && code <= 57) || code === 46 /* . */) {
        while (index < text.length && !isSpace(text.charCodeAt(index)) && text.charCodeAt(index) !== 44) index++;
        continue;
      }
      if (!isWordStart(code)) continue;

      const start = index;
      while (index < text.length && isWordCharacter(text.charCodeAt(index))) index++;

      // A function: the name is not a keyword and its arguments are its own grammar.
      if (text.charCodeAt(index) === 40 /* ( */) {
        index = endOfCall(text, index);
        continue;
      }

      out.push({ text: text.slice(start, index), at: part.at === undefined ? undefined : part.at + start });
      index--;
    }

    if (glued.before && out.length > first) out.splice(first, 1);
    if (glued.after && out.length > first) out.pop();
  }

  return out;
}

function endOfString(text: string, start: number): number {
  const quote = text.charCodeAt(start);
  let index = start + 1;
  while (index < text.length) {
    if (text.charCodeAt(index) === 92) {
      index += 2;
      continue;
    }
    if (text.charCodeAt(index) === quote) return index;
    index++;
  }
  return index;
}

function endOfCall(text: string, open: number): number {
  let index = open + 1;
  let depth = 1;
  while (index < text.length && depth > 0) {
    const code = text.charCodeAt(index);
    if (code === 34 || code === 39) {
      index = endOfString(text, index);
    } else if (code === 40) depth++;
    else if (code === 41) depth--;
    index++;
  }
  return index - 1;
}

const isSpace = (code: number) => code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
const isWordStart = (code: number) => (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
const isWordCharacter = (code: number) => isWordStart(code) || (code >= 48 && code <= 57) || code === 45 || code === 95;

/* ── the near miss ─────────────────────────────────────────────────────────────────────────── */

/**
 * The closest name, or nothing when nothing is close.
 *
 * The bound is what keeps the suggestion honest: a name three edits away from `flex-direction` is
 * not a typo of it, and offering one anyway sends a reader to change a line that was right for a
 * different reason. Scaled by length, so a short name needs a closer match than a long one.
 */
function nearest(word: string, among: readonly string[]): string | undefined {
  const bound = Math.min(3, Math.max(1, Math.floor(word.length / 4)));
  let best: string | undefined;
  let closest = bound + 1;

  for (const candidate of among) {
    if (Math.abs(candidate.length - word.length) > closest) continue;
    const distance = editDistance(word, candidate, closest);
    if (distance < closest) {
      closest = distance;
      best = candidate;
    }
  }

  return best;
}

/**
 * Levenshtein, abandoned as soon as every cell in a row is past the bound.
 *
 * The bound is what makes this affordable: `unknown-value` asks it once per word against a set that
 * can be 160 colours long, and a full matrix per candidate would be the checker's whole cost.
 */
function editDistance(a: string, b: string, bound: number): number {
  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);

  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost);
      row.push(value);
      if (value < best) best = value;
    }

    if (best > bound) return bound + 1;
    previous = row;
  }

  return previous[b.length];
}
