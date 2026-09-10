import type { Block, BlockItem, ValuePart } from "./ast";
import { HOLE } from "./normalise";
import { holeOutOfPlace, refuse } from "./errors";

/**
 * Reading one block: the CSS between `@(` and its `)`, and the expressions carried inside it.
 *
 * Two grammars meet here and neither can be read with the other's rules. The block is CSS, so a
 * `)` inside a string does not close it and `url(a.png)` is not a nesting level anybody meant. A
 * hole is JavaScript, so `{{ pick({ on: "}}" }) }}` ends at the last `}}` and not the first.
 * Everything below is that: two scanners that know which one they are in.
 *
 * **What comes out is a {@link Block}, not text.** Normalisation is defined on the parsed form —
 * see CONTRACT.md — because nothing that reads characters can tell the meaningless space before a
 * declaration's colon from the combinator in `& :first-child`.
 *
 * ## Two modes, because a build and an editor want opposite things
 *
 * A build must refuse a block it cannot read: there is no correct compilation, and guessing would
 * ship a style that silently does not apply. An editor sees nothing BUT half-written blocks —
 * measured on the keystroke states a person passes through, `disp` and `&:hover { col }` both refuse,
 * and a refusal means no virtual file, which means no completions exactly when they are wanted.
 *
 * So `tolerant` is a second mode of one parser rather than a second parser. **Strict is the default**,
 * so nothing gets the forgiving reading by forgetting to ask for it.
 */

/**
 * What opens a conditional group — see the note in `readHead`.
 *
 * **No `@@`, and that is the rule the sigil now has: `@@` opens a BLOCK and nothing else.** Inside a
 * block the language is the block's own, and it already spells itself without a sigil — `{expr}` is a
 * hole and `...{expr}` is a spread, both borrowed from JavaScript and read as JavaScript. `@@if` was
 * the one place `@@` appeared inside a block, which made the sigil mean two things.
 *
 * It also collided with the named-site shape: measured, `@@if({on})` with no space was read as a
 * site named `if` and refused as *a block cannot contain another block* — a message about the wrong
 * thing, one keystroke away.
 *
 * **`if (` is safe, and it was measured rather than assumed.** In Chromium 151, `if (x) { … }` in a
 * prelude is DROPPED: a type selector may not be followed by parentheses, and a functional
 * pseudo-class needs its colon. Nothing in CSS starts with a bare word and takes parens — `@media`,
 * `@supports`, `@container`, `@layer`, `@scope` and the drafted `@when` all carry an `@`. The `if()`
 * CSS Values 5 shipped in Chrome 137 is a VALUE function, after the colon, which is a different
 * position entirely.
 *
 * The one CSS meaning `if` has here is a bare `if { … }`, a type selector for an element that cannot
 * exist: measured, `customElements.define("if", …)` is refused because a custom element name must
 * contain a hyphen. It is reported rather than compiled — see `guard-without-a-condition`.
 */
export const CONDITION = "if";

/** `if` and its opening paren, with any whitespace between them — see where it is used. */
const CONDITION_HEAD = new RegExp(`^${CONDITION}\\s*\\($`);

/**
 * A prelude that is TRYING to be a condition, well formed or not.
 *
 * The word and a boundary, because the marker is a word now: `startsWith` was enough for `@@if`,
 * which cannot begin a selector, and with a bare `if` it reported `iframe { … }` — valid CSS, and a
 * false report is the one thing this file may not produce. Measured, on the first run after the
 * rename.
 *
 * `if.active` and `if { … }` match too, and are refused rather than compiled: both name an element
 * that cannot exist, because a custom element's name must contain a hyphen. Somebody who means the
 * selector writes `& if { … }`, which names the parent and is not this shape.
 */
const OPENS_A_CONDITION = new RegExp(`^${CONDITION}\\b`);

/** What a condition used to be spelled, so the rename says so rather than failing as something else. */
const OLD_CONDITION_HEAD = new RegExp(`^@@${CONDITION}\\s*\\($`);

/** What opens a spread of another block's map. */
export const SPREAD = "...";

/**
 * The hole index a composition marker's head holds — `@@if {{c}}`, `...{{base}}` — or nothing.
 *
 * One definition, because two readers of one syntax is where this package keeps finding faults: the
 * transform, the virtual file and the rules all ask this and must agree. The marker and one hole and
 * nothing else — `@@iffy {{c}}` is not a condition and `... {{a}} {{b}}` is not a spread, so both
 * fall through to being read as what they look like and are refused there.
 */
export function holeIn(head: string, marker: string): number | undefined {
  // A condition PARENTHESISES its hole — `@@if ({cond})`, the shape `@media (…)` has — and a spread
  // does not, because a spread is a declaration's position rather than an at-rule's head.
  const escaped = marker === SPREAD ? "\\.\\.\\." : marker;
  const open = marker === SPREAD ? "" : "\\(\\s*";
  const close = marker === SPREAD ? "" : "\\s*\\)";
  const found = new RegExp(`^\\s*${escaped}\\s*${open}${HOLE}(\\d+)${HOLE}${close}\\s*$`).exec(head);
  return found === null ? undefined : Number(found[1]);
}

/** The head of a spread: the marker and one hole, and nothing else. */
export function isSpread(head: string): boolean {
  return holeIn(head, SPREAD) !== undefined;
}

export interface ReadOptions {
  /**
   * Recover instead of refusing: a property with no colon is that property with no value, an
   * unclosed block or hole ends where the text does, and a hole in a position a custom property
   * cannot occupy is kept as ordinary text.
   *
   * For an editor only. The CSS checker is what tells the author about the fault; taking the whole
   * file's completions away is not a way to say it.
   */
  readonly tolerant?: boolean;
  /**
   * What a hole's expression stands for, when it stands for something known at BUILD time.
   *
   * The expression, trimmed, in — the text to write in its place, or `undefined` for a hole that is
   * a hole. A resolved one is not recorded as a hole at all: it becomes ordinary text, so it is part
   * of the block's hash, needs no custom property, and may stand where a hole may not — in a
   * property NAME, which is how a registered custom property is set.
   *
   * See {@link namedSites}, which is the only thing that supplies one.
   */
  readonly resolve?: (expression: string) => string | undefined;
}
/**
 * A read whose job is not to REPORT anything: `undefined` where {@link readBlock} would refuse.
 *
 * Three readers want this — the two in `references.ts` that only need a site's NAME, and the loop in
 * `transform.ts` that carries an imported module's rule across. All three pass `tolerant`, whose
 * comment already says "what is wrong with the block is reported by whoever reads it properly", and
 * all three passed a filename they could not honour: the reference readers passed `""` and the
 * imported-rule loop passed the IMPORTING file's name with an offset into the imported text.
 *
 * Measured: a NUL in a `@@property` block — refused in both modes on purpose, since it is what marks
 * a hole in the compiler's own text — came out of a build as `:1:36  a NUL character cannot be
 * written…`. A refusal naming no file at all, ahead of the read that would have named the right one.
 * The same shape as the review that found a rename writing at positions in a file nobody wrote.
 */
export function tryReadBlock(source: string, open: number, options: ReadOptions = {}): ReadBlock | undefined {
  try {
    return readBlock(source, open, "", { ...options, tolerant: true });
  } catch {
    // Whoever reads this text properly is where it is reported: its own file's transform.
    return undefined;
  }
}

export interface ReadBlock {
  readonly block: Block;
  /** Each carried expression's own bytes, in source coordinates and in source order. */
  readonly holes: readonly Span[];
  /** Offset of the `)` that closed the block. */
  readonly end: number;
}

export interface Span {
  readonly start: number;
  readonly end: number;
}

const PAREN = 41; /* ) */
const BRACE = 125; /* } */

/**
 * Where the hole opening at `at` closes — the offset of its `}}` — or -1 when it never does.
 *
 * **It cannot be `indexOf("}}")`**, and that is the whole reason this is a function. The inside of a
 * hole is JavaScript, so `{{ pick({ on: "}}" }) }}` ends at the LAST `}}` and not the first, and
 * `{{ {a: {b: 1}}.a.b }}` has one in the middle of an object literal. Braces, parens, brackets,
 * strings, templates and comments are all counted.
 *
 * **A REGEX LITERAL is counted too**, which it was not until a review measured
 * `{s.replace(/}/g, "")}` coming back as a hole that never closes.
 *
 * Telling a regex from a division looked like it needed a JavaScript lexer, and it does not: it needs
 * the PREVIOUS SIGNIFICANT TOKEN, which is a closed question. After a name, a number, `)`, `]`, `}`
 * or a `++`/`--`, a `/` divides. After anything else — an operator, `(`, `[`, `,`, `:`, the start, or
 * one of the keywords in {@link A_REGEX_FOLLOWS} — it opens a regex. Whitespace and comments change
 * nothing, so they are stepped over without touching the answer.
 *
 * **A `}` is read as dividing**, and that is the one genuinely ambiguous case: `({a: 1}).a / 2`
 * divides, while a block statement followed by `/re/` does not. Inside a hole the object literal is
 * the form that occurs and its `)` decides anyway, so the ambiguity is resolved towards the shape
 * this language actually holds.
 *
 * **And a `/` with no closer on its own line is division**, whatever came before it — a regex
 * literal cannot span lines, so an unterminated one is not a regex at all. That is what keeps a
 * misjudged slash from swallowing the rest of the block.
 *
 * Exported because three scanners ask the same question — the parser, the formatter's layout, and
 * the rule that looks for a `//` — and two of them used to ask it with `indexOf`, which is how a
 * hole holding an object literal came back cut in half.
 */
export function closingHole(source: string, at: number): number {
  let index = at + 1;
  let depth = 0;
  /** Whether a `/` at the current position would DIVIDE rather than open a regex — see above. */
  let divides = false;

  while (index < source.length) {
    const code = source.charCodeAt(index);

    if (code === 34 /* " */ || code === 39 /* ' */ || code === 96 /* ` */) {
      index = pastExpressionString(source, index);
      divides = true;
      continue;
    }
    if (code === 47 /* / */) {
      const next = source.charCodeAt(index + 1);
      if (next === 47) {
        const line = source.indexOf("\n", index);
        index = line === -1 ? source.length : line + 1;
        continue;
      }
      if (next === 42) {
        const close = source.indexOf("*/", index + 2);
        index = close === -1 ? source.length : close + 2;
        continue;
      }
      if (!divides) {
        const past = pastRegex(source, index);
        if (past !== -1) {
          index = past;
          divides = true;
          continue;
        }
      }
      // Division, or a slash with no closer on its line, which is the same decision.
      divides = false;
      index++;
      continue;
    }
    if (isSpace(code)) {
      index++;
      continue;
    }
    // A name or a number, and a KEYWORD is the case that flips the answer back.
    if (isWordCharacter(code)) {
      const start = index;
      while (index < source.length && isWordCharacter(source.charCodeAt(index))) index++;
      divides = !A_REGEX_FOLLOWS.has(source.slice(start, index));
      continue;
    }

    if (code === 123 /* { */ || code === 40 /* ( */ || code === 91 /* [ */) {
      depth++;
      divides = false;
    } else if (code === 41 /* ) */ || code === 93 /* ] */) {
      depth--;
      divides = true;
    } else if (code === BRACE) {
      // Just PAST the closer, so no caller has to know how long the closer is. It used to return the
      // first of `}}` and every one of the four call sites added 2.
      if (depth === 0) return index + 1;
      depth--;
      divides = true;
    } else {
      // An operator, and `a++ / b` is the one that would otherwise read as a regex.
      const twice = code === 43 /* + */ || code === 45 /* - */;
      divides = twice && source.charCodeAt(index + 1) === code;
    }
    index++;
  }

  return -1;
}

/**
 * The keywords after which a `/` opens a REGEX, though they are spelled like names.
 *
 * Everything else that reads as a word — an identifier, a number, `true`, `this` — is a value, and a
 * `/` after a value divides. These are the operators and statement heads that are written with
 * letters, so the character test cannot tell them apart from a name.
 */
const A_REGEX_FOLLOWS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "case",
  "do",
  "else",
  "yield",
  "await",
  "throw",
]);

/**
 * Where the regex literal opening at `at` ends, past its flags — or -1 when it is not one.
 *
 * A `[ … ]` class holds a `/` without ending the literal, which is the case that makes this more
 * than an `indexOf`. A `\` escapes whatever follows it, delimiter included.
 *
 * **A newline means it was never a regex.** A regex literal cannot span lines, so a `/` with no
 * closer on its own line is division however it looked — and answering -1 there is what stops a
 * misjudged slash from swallowing the rest of the block.
 */
function pastRegex(source: string, at: number): number {
  let index = at + 1;
  let inClass = false;

  while (index < source.length) {
    const code = source.charCodeAt(index);

    if (code === 92 /* \ */) {
      index += 2;
      continue;
    }
    if (code === 10 || code === 13) return -1;
    if (code === 91 /* [ */) inClass = true;
    else if (code === 93 /* ] */) inClass = false;
    else if (code === 47 /* / */ && !inClass) {
      index++;
      // The flags, which are letters and nothing else.
      while (index < source.length && isFlagLetter(source.charCodeAt(index))) index++;
      return index;
    }
    index++;
  }

  return -1;
}

/** A regex flag: `d g i m s u v y`, and any letter, because a wrong one is TypeScript's to report. */
function isFlagLetter(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
}

/**
 * A character a JAVASCRIPT name or number is made of, which is not what CSS means by one.
 *
 * `rules.ts` has a helper of this name that includes `-`, because a CSS property holds one. Here a
 * `-` is subtraction, and reading it as part of a name would make `a-b` end in a value and turn the
 * `/` after it into a division when it is one — right by accident — while `x /re/` after a minus
 * would go the other way. Its own function rather than the shared one, and this is the note that
 * says the difference was chosen.
 *
 * `$` and `_` are name characters; a digit is not a name START but this is only ever asked of a run.
 */
function isWordCharacter(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 95 /* _ */ ||
    code === 36 /* $ */
  );
}

/**
 * Whether a `{` opens a HOLE rather than a nested rule, judged by the text in front of it.
 *
 * A hole is one brace, so this is the one question the parser has that CSS's own grammar cannot
 * answer — and there are exactly three positions where a `{` is a hole, each of them something a
 * selector provably is not:
 *
 * - **nothing in front of it**, a hole in a property NAME — `{accent}: #34d399`, the only way to set
 *   a registered property. A prelude cannot start with `{`: that would be an empty selector.
 * - **exactly `<name>:`**, a value. A selector cannot END in a colon, which is what makes `&:hover`,
 *   `@media (min-width: 40rem)` and `&[data-x="y"]` unambiguous — measured against every prelude in
 *   this repository, twelve distinct, none misread.
 * - **exactly `...`**, a spread.
 *
 * And one that is a bracket rather than a position: **immediately after `(`**. That is the
 * condition, `@@if ({cond})`, and a hole inside a function, `url({href})`. No CSS construct puts a
 * `{` after a `(`, so it cannot be anything else.
 *
 * **The condition needing no case of its own is why it is parenthesised.** `@@if {cond} {` would put
 * two brackets of different kinds a space apart, and `} {` reads as a close and an open at one
 * level. `@@if ({cond}) {` is the shape `@media (…) {` already has — and it is the same length as
 * the `{{ }}` spelling it replaces, so the readable form costs nothing.
 */
/**
 * A property name, a colon, and then either a space or the end of the text.
 *
 * **The space is load-bearing and a probe found it.** A bare type selector is a legal prelude —
 * `a:hover { … }` parses today — and it begins with a property-shaped name and a colon exactly like
 * `border: 4px solid` does. What separates them is that a declaration's colon is followed by
 * whitespace or by the value itself, and a pseudo-class's is followed immediately by its own name.
 *
 * So `a:hover` is a selector, `color:{accent}` is a value, and `border: 4px solid {accent}` is a
 * value. Measured against every prelude in this repository and against the four bare-type-selector
 * shapes the parser accepts.
 *
 * **The NAME is every name CSS allows, which it was not.** A review found that requiring an ASCII
 * letter first read `-webkit-mask: {m}` as a nested rule whose prelude was the declaration — and a
 * vendor prefix on a property is ordinary CSS. So: a custom property is `--` and then anything a
 * name may hold, and any other property is an optional single dash, then a letter, an underscore or
 * a non-ASCII character, then name characters. `--2x`, `--_x` and `--héllo` are all legal custom
 * properties and all three were refused.
 *
 * Nothing noticed because the same names parse correctly with an ordinary value: this regex is only
 * consulted where a `{` follows, so a property that never carried a hole never met it.
 */
const A_DECLARATION =
  /^\s*(?:--(?:[\w-]|[\u0080-\uFFFF])+|-?(?:[a-zA-Z_]|[\u0080-\uFFFF])(?:[\w-]|[\u0080-\uFFFF])*)\s*:(\s|$)/;

/**
 * A declaration whose property NAME is itself a hole — `{angle}: 45deg`, the way a registered
 * property is set. The value after it is a value like any other, and may be a hole too.
 *
 * Without this the second `{` was read as a rule opening: the text in front of it starts with `{`,
 * so no other clause matched. Found by a test that set a registered property to a computed value,
 * which is a shape somebody would write on their first day with `@@property`.
 */
const A_HELD_NAME = /^\s*\{[^{}]*\}\s*:(\s|$)/;

export function opensAHole(before: string): boolean {
  const text = before.trimEnd();
  return text === "" || text === SPREAD || text.endsWith("(") || A_DECLARATION.test(before) || A_HELD_NAME.test(before);
}

export function readBlock(source: string, open: number, filename: string, options: ReadOptions = {}): ReadBlock {
  const tolerant = options.tolerant === true;
  const resolve = options.resolve;
  const holes: Span[] = [];
  /**
   * A literal `U+0000`, refused before anything is read.
   *
   * `normalise` builds the hole placeholder out of this character, and its note used to say an
   * author could not write one — because CSS preprocessing turns a NUL into U+FFFD. A block is read
   * out of a TYPESCRIPT file, where nothing preprocesses it as CSS, so the premise never held: a
   * review measured a block carrying two of them sharing an identity, and a class, with a block
   * carrying a real hole. Refused rather than escaped, because it is a control character with no
   * meaning in CSS — there is nothing to preserve, and refusing keeps the placeholder unforgeable
   * by construction rather than by an argument that turned out to be wrong.
   *
   * In both modes. An editor cannot want this either, and a keystroke does not produce it.
   */
  const nul = source.indexOf("\u0000", open);
  if (nul !== -1) {
    refuse(
      "a NUL character cannot be written in a style block — it is what marks a hole in the compiler's own text.",
      source,
      nul,
      filename,
    );
  }
  /** Where we are. Every function below moves it and none of them backtrack. */
  let at = open + 1;

  /* ---- the two scanners ---------------------------------------------------------------------- */

  /** Past a CSS string, which may contain anything including the block's own closing paren. */
  function pastString(): void {
    const quote = source.charCodeAt(at);
    at++;
    while (at < source.length) {
      const code = source.charCodeAt(at);
      if (code === 92 /* \ */) {
        at += 2;
        continue;
      }
      at++;
      if (code === quote) return;
    }
  }

  /**
   * Past one hole, recording its expression, and returns the part that stands for it.
   *
   * `at` is on the first `{` of `{{`. The end is the first `}}` at brace depth zero **in the
   * expression's own grammar** — braces, parens, brackets, strings and templates all counted, which
   * is why this cannot be `indexOf("}}")`.
   */
  function pastHole(): ValuePart {
    /** Where the `{` itself is, before `at` moves past the hole. */
    const opens = at;
    const start = at + 1;
    /** Just past the `}` — see {@link closingHole}. */
    const close = closingHole(source, at);

    if (close === -1 && !tolerant) {
      refuse("this hole is never closed — a `{` needs a `}`.", source, at, filename);
    }

    const end = close === -1 ? source.length : close - 1;

    /**
     * A reference to a named site is not a hole — see {@link namedSites}. It is text this compiler
     * decided itself, so it goes into the block as text: part of the hash, and no custom property.
     */
    const written = close === -1 ? undefined : resolve?.(source.slice(start, end).trim());
    if (written !== undefined) {
      at = close;
      // `resolved`, because this text is the compiler's and holds nothing anybody can act on — see
      // the field's own note for the false report that found it.
      return { kind: "text", text: written, at: opens, resolved: true };
    }

    // Unclosed and tolerant: everything to the end of the text is the expression. Mid-typing, that
    // is what it is.
    const part: ValuePart = {
      kind: "hole",
      index: holes.length,
      at: opens,
      length: (close === -1 ? source.length : close) - opens,
    };
    holes.push({ start, end });
    at = close === -1 ? source.length : close;
    return part;
  }

  /* ---- deciding what an item is ---------------------------------------------------------------- */

  function skipTrivia(): void {
    while (at < source.length) {
      const code = source.charCodeAt(at);
      if (code === 32 || code === 9 || code === 10 || code === 13 || code === 12) {
        at++;
        continue;
      }
      if (code === 47 /* / */ && source.charCodeAt(at + 1) === 42) {
        const close = source.indexOf("*/", at + 2);
        at = close === -1 ? source.length : close + 2;
        continue;
      }
      return;
    }
  }

  /**
   * Whether the item starting at `at` is a nested rule or a declaration, decided by which of `{` and
   * `;` comes first at depth zero.
   *
   * A lookahead rather than a guess, because `:` cannot decide it: `&:hover` and `color: red` both
   * have one, and `@media (min-width: 40rem)` has one inside parens. Holes are stepped over here
   * rather than judged — whether a hole is allowed where it stands is the head scan's question, and
   * it needs to know which kind it is reading before it can answer.
   */
  function looksLikeARule(closer: number): boolean {
    let index = at;
    let depth = 0;
    /**
     * The head as the READ will see it, built as the scan goes.
     *
     * Not `source.slice(at, index)`, which is what this passed to `opensAHole` until a review looked
     * at it. `readHead` collapses every comment to one space before asking the same question, so the
     * two disagreed wherever a comment sat near a colon: one between a property and its colon was a rule to the
     * lookahead and a hole to the reader, and a legal declaration was refused as a hole in a
     * selector. The comment that used to be here claimed they could not disagree.
     */
    let head = "";

    while (index < source.length) {
      const code = source.charCodeAt(index);

      if (code === 34 || code === 39) {
        const mark = at;
        at = index;
        pastString();
        head += source.slice(index, at);
        index = at;
        at = mark;
        continue;
      }
      /**
       * A comment, which this did not read at all — while `skipTrivia`, `readHead` and `readValue`
       * all do. Three faults came out of that one gap, and the loud one EMITTED: a `;`, a `(` or a
       * `)` inside a prelude's comment ended this scan, so a prelude carrying a commented-out
       * `focus;` was read
       * as a declaration whose value was the rule's body, and the module that came out was a syntax
       * error at no line the author had written.
       *
       * One space, for the reason `readHead` gives: a comment separates tokens, and joining `1px` to
       * `2px` would make one value out of two.
       */
      if (code === 47 /* / */ && source.charCodeAt(index + 1) === 42) {
        const close = source.indexOf("*/", index + 2);
        index = close === -1 ? source.length : close + 2;
        head += " ";
        continue;
      }
      if (code === 123 /* { */) {
        // The one question CSS's grammar cannot answer — see {@link opensAHole}, asked with the text
        // the head reader will have built rather than with the raw source.
        if (opensAHole(head)) {
          const mark = at;
          at = index;
          pastHoleWithoutRecording();
          head += source.slice(index, at);
          index = at;
          at = mark;
          continue;
        }
        if (depth === 0) return true;
      }
      /**
       * A paren is handled to the end here rather than falling through to the tests below it. The
       * closing paren of `url(a.png)` decrements the depth to zero, and the next test would then
       * read it as the block's own closer — measured, `background: url(a.png) no-repeat` came out
       * as `background:url(a.png;`, and `@media (min-width: 40rem) { … }` stopped being a rule.
       */
      if (code === 40) {
        depth++;
        head += "(";
        index++;
        continue;
      }
      if (code === PAREN) {
        if (depth === 0) return false;
        depth--;
        head += ")";
        index++;
        continue;
      }
      if (depth === 0 && (code === 59 /* ; */ || code === closer)) return false;
      head += source[index];
      index++;
    }
    return false;
  }

  /** The lookahead's copy of {@link pastHole}: it must not number a hole it is only stepping over. */
  function pastHoleWithoutRecording(): void {
    const kept = holes.length;
    pastHole();
    holes.length = kept;
  }

  /* ---- the items themselves ------------------------------------------------------------------- */

  /**
   * The text before a `{` or a `:`, with a hole in it refused.
   *
   * This is the whole of decision 1 in DESIGN.md: a custom property holds a **value**, so a hole
   * cannot be a property name, a selector, or a declaration. Refused here with the hole's own
   * position rather than the block's, because that is the character the author has to move.
   */
  function readHead(stopAt: number, what: "a selector" | "a property name"): string {
    const from = at;
    let text = "";
    let depth = 0;

    while (at < source.length) {
      const code = source.charCodeAt(at);

      if (code === 34 || code === 39) {
        const start = at;
        pastString();
        text += source.slice(start, at);
        continue;
      }
      if (code === 47 && source.charCodeAt(at + 1) === 42) {
        const close = source.indexOf("*/", at + 2);
        at = close === -1 ? source.length : close + 2;
        // A space, not nothing: a comment separates tokens, and joining `1px` to `2px` would make
        // one value out of two.
        text += " ";
        continue;
      }
      if (code === 123 && opensAHole(text)) {
        /**
         * The one hole that MAY stand in a property name: a reference to a registered property,
         * which is a name this compiler generated and the author has no other way to write.
         * `{angle}: 45deg` is how a `@@property( … )` is set, and without it registering one is
         * only half a feature — nothing else can name it.
         */
        const close = closingHole(source, at);
        const written = close === -1 ? undefined : resolve?.(source.slice(at + 1, close - 1).trim());
        if (written !== undefined) {
          text += written;
          at = close;
          continue;
        }

        /**
         * The two heads that ARE an expression rather than a name.
         *
         * `@@if {{cond}}` and `...{{block}}` are composition, and what follows the marker is
         * TypeScript — which is what `{{ }}` means everywhere else in a block. Recorded like any
         * other hole, so the transform leaves the author's expression exactly where they wrote it,
         * and marked in the text with the same placeholder a value uses.
         */
        /**
         * The marker, with whatever whitespace was typed between it and its parenthesis.
         *
         * Compared by equality against `"@@if ("` and `"@@if("` until a review found it: two spaces,
         * a tab or a newline turned a condition into *a hole cannot stand in a selector* — a refusal
         * naming the wrong thing, on code whose only fault was its spacing. Every other whitespace
         * in a block is free, and `holeIn` allows it on both sides of everything else.
         */
        const head = text.trimEnd();
        if (CONDITION_HEAD.test(head) || head === SPREAD) {
          const part = pastHole();
          // A part that came back as TEXT is a reference to a named site, resolved at build time —
          // a `@@keyframes` name, which is a string and not a condition or a block. It falls
          // through to the refusal below, which is the right answer for it.
          if (part.kind === "hole") {
            text += `${HOLE}${part.index}${HOLE}`;
            continue;
          }
        }

        /**
         * THE OLD SPELLING, named for what it was rather than left to fail as something else.
         *
         * `@@if` was the one place `@@` appeared INSIDE a block, and the sigil means one thing now: a
         * block opens with it and nothing else does. Left to the refusal below, `@@if ({on})` came
         * back as *a hole cannot stand in a selector* — true, and about the wrong thing.
         */
        if (!tolerant && OLD_CONDITION_HEAD.test(head)) {
          refuse(
            `\`@@${CONDITION}\` is written \`${CONDITION} ({ … })\` now — \`@@\` opens a block and ` +
              "nothing else, and everything inside one is the block's own language.",
            source,
            at,
            filename,
          );
        }

        if (!tolerant) refuse(holeOutOfPlace(at === from ? "a declaration" : what), source, at, filename);
        // Kept as text, so the rest of the block still reads. The fault is the checker's to name.
        const start = at;
        pastHoleWithoutRecording();
        text += source.slice(start, at);
        continue;
      }
      // Handled to the end, for the reason written out in `looksLikeARule`.
      if (code === 40) {
        depth++;
        text += "(";
        at++;
        continue;
      }
      if (code === PAREN) {
        if (depth === 0) break;
        depth--;
        text += ")";
        at++;
        continue;
      }
      if (depth === 0 && (code === stopAt || code === BRACE || code === 59)) break;

      text += source[at];
      at++;
    }

    return text;
  }

  /** A declaration's value: text and holes, up to `;` or whatever closes the block it is in. */
  function readValue(closer: number): ValuePart[] {
    const parts: ValuePart[] = [];
    let text = "";
    let depth = 0;
    /** Where the run being built started, so the CSS checker can point at a word inside it. */
    let textAt = at;

    const flush = () => {
      if (text !== "") {
        parts.push({ kind: "text", at: textAt, text });
        text = "";
      }
      textAt = at;
    };

    while (at < source.length) {
      const code = source.charCodeAt(at);

      if (code === 34 || code === 39) {
        const start = at;
        pastString();
        text += source.slice(start, at);
        continue;
      }
      if (code === 47 && source.charCodeAt(at + 1) === 42) {
        const close = source.indexOf("*/", at + 2);
        at = close === -1 ? source.length : close + 2;
        text += " ";
        continue;
      }
      // Inside a value there is nothing else a `{` could be, so no question is asked here.
      if (code === 123) {
        flush();
        parts.push(pastHole());
        /**
         * The run AFTER a hole starts after the hole, and it used to start where the hole did.
         *
         * `flush` moves the mark to `at`, and at that moment `at` is the `{` — so the trailing run
         * of `4px solid {w} inset` recorded the hole's own offset. Two runs claiming one position is
         * what broke the reverse lookup: it sorts by author offset, the trailing run sorted before
         * the hole between them, and **every author offset past the first hole in a value mapped
         * nowhere**. Measured by sweeping every offset in a block through it and back.
         */
        textAt = at;
        continue;
      }
      // Handled to the end, for the reason written out in `looksLikeARule`.
      if (code === 40) {
        depth++;
        text += "(";
        at++;
        continue;
      }
      if (code === PAREN) {
        if (depth === 0) break;
        depth--;
        text += ")";
        at++;
        continue;
      }
      if (depth === 0 && (code === 59 || code === closer)) break;

      text += source[at];
      at++;
    }

    flush();
    return parts;
  }

  function readItems(closer: number): BlockItem[] {
    const items: BlockItem[] = [];

    for (;;) {
      skipTrivia();
      if (at >= source.length) {
        if (!tolerant) refuse("this block is never closed — a `@(` needs a `)`.", source, open, filename);
        return items;
      }
      if (source.charCodeAt(at) === closer) {
        at++;
        return items;
      }
      if (source.charCodeAt(at) === 59 /* ; */) {
        // An empty declaration. CSS allows it and it says nothing, so neither does the block.
        at++;
        continue;
      }

      const from = at;

      if (looksLikeARule(closer)) {
        const prelude = readHead(123 /* { */, "a selector").trim();

        /**
         * A condition is the marker and ONE hole, and nothing else.
         *
         * **Measured before this refusal existed: `@@if {{on}}Error { … }` compiled.** A hole is let
         * into a prelude only when the text so far is exactly `@@if`, and after recording it the
         * read carries on — so anything written after the hole joined the prelude as ordinary text
         * and nothing asked about it. The group still worked, which is why it was silent.
         *
         * The mirror case was already refused, and that asymmetry is what gave it away: the text
         * BEFORE the hole was checked and the text after it was not.
         */
        /**
         * THE OLD SPELLING, named for what it was rather than left to fail as something else.
         *
         * `@@if` was the one place `@@` appeared inside a block, and the sigil means one thing now:
         * a block opens with it and nothing else does. Left alone, `@@if ({on})` fails as *a hole
         * cannot stand in a selector* — true, and about the wrong thing.
         */
        if (prelude.startsWith(`@@${CONDITION}`) && !tolerant) {
          refuse(
            `\`@@${CONDITION}\` is written \`${CONDITION} ({ … })\` now — \`@@\` opens a block and ` +
              "nothing else, and everything inside one is the block's own language.",
            source,
            from,
            filename,
          );
        }

        if (OPENS_A_CONDITION.test(prelude) && holeIn(prelude, CONDITION) === undefined && !tolerant) {
          refuse(
            `\`${CONDITION}\` takes one parenthesised \`({ … })\` and nothing else — everything the ` +
              "condition needs goes inside the braces, where it is ordinary TypeScript. To select an " +
              `element named \`${CONDITION}\` instead, name the parent: \`& ${CONDITION} { … }\`.`,
            source,
            from,
            filename,
          );
        }
        // `readHead` stopped on the `{` the lookahead found, so this cannot be anything else.
        at++;
        items.push({ kind: "rule", at: from, preludeEnd: at - 1, prelude, items: readItems(BRACE) });
        continue;
      }

      const property = readHead(58 /* : */, "a property name").trim();
      if (at >= source.length || source.charCodeAt(at) !== 58) {
        /**
         * A spread has no value, and that is what it IS: `...{{base}};` merges another block's map
         * at this point rather than setting anything. It reaches here because it has no colon —
         * which for everything else is the missing half of a declaration.
         */
        if (isSpread(property)) {
          if (at < source.length && source.charCodeAt(at) === 59) at++;
          items.push({ kind: "declaration", at: from, end: at, property, value: [] });
          continue;
        }

        if (!tolerant) {
          refuse(
            `\`${property.trim()}\` is not a declaration — a block holds \`property: value;\` and nested rules, nothing else.`,
            source,
            // `from`, not `at - property.length`: the name is trimmed, so measuring its length back
            // from a position past the whitespace pointed one column further right for every space
            // after it. `disp ` reported column 6 for a word beginning at 5.
            from,
            filename,
          );
        }
        /**
         * A property being typed, which is the state an editor is in most. It becomes that property
         * with no value — which is what puts the caret inside an object-literal KEY in the virtual
         * file, and an object-literal key is where TypeScript offers the property names.
         */
        if (at < source.length && source.charCodeAt(at) === 59) at++;
        /**
         * **A recovery has to move.**
         *
         * `readHead` stops WITHOUT consuming anything when the first thing it meets is a `}`, a `)`
         * or a `;` — a stray brace, or the block's own paren reached from inside a nested rule that
         * was never closed. Pushing a declaration made of nothing and going round again from the
         * same character is an infinite loop, and tolerant is the mode an EDITOR runs on every
         * keystroke: measured, the reading of `&:hover { color: red;` never returned, which does not
         * report a wrong squiggle — it takes the language server with it.
         *
         * There is no declaration at a character that starts nothing, so none is recorded either.
         */ else if (at === from) {
          at++;
          continue;
        }
        items.push({ kind: "declaration", at: from, valueAt: at, end: at, property, value: [] });
        continue;
      }
      at++;
      // Past the whitespace after the colon, so the value's position is the value and not the gap
      // before it. What `readValue` then collects has no leading whitespace, which normalisation was
      // going to trim anyway.
      while (at < source.length && isSpace(source.charCodeAt(at))) at++;
      const valueAt = at;
      const value = readValue(closer);
      const end = at;
      /**
       * A colon with nothing after it, which a BUILD may not accept and an editor must.
       *
       * `.r-x { color:; }` is what it emitted — a declaration no browser accepts, on a class still
       * written into the markup, so the element carried a rule that did nothing. A review found it.
       *
       * Refused only in the strict read, because a value with nothing typed yet is the state an
       * editor is in most: the tolerant read keeps the declaration so the caret has a value position
       * to complete in.
       */
      if (!tolerant && value.length === 0) {
        refuse(`\`${property.trim()}\` has no value — a declaration is \`property: value;\`.`, source, from, filename);
      }
      if (at < source.length && source.charCodeAt(at) === 59) at++;
      items.push({ kind: "declaration", at: from, valueAt, end, property, value });
    }
  }

  const items = readItems(PAREN);
  return { block: { items }, holes, end: at - 1 };
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

/** Past a string or template in an EXPRESSION, following `${ … }` back into code. */
function pastExpressionString(source: string, start: number): number {
  const quote = source.charCodeAt(start);
  let index = start + 1;

  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 92 /* \ */) {
      index += 2;
      continue;
    }
    if (code === quote) return index + 1;
    if (quote === 96 && code === 36 /* $ */ && source.charCodeAt(index + 1) === 123) {
      index = pastSubstitution(source, index + 2);
      continue;
    }
    index++;
  }
  return index;
}

function pastSubstitution(source: string, start: number): number {
  let index = start;
  let depth = 1;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 34 || code === 39 || code === 96) {
      index = pastExpressionString(source, index);
      continue;
    }
    if (code === 123) depth++;
    else if (code === 125) {
      depth--;
      if (depth === 0) return index + 1;
    }
    index++;
  }
  return index;
}
