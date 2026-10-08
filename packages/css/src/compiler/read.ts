import type {
  Block,
  BlockArm,
  BlockItem,
  BlockMatch,
  ChoiceBranch,
  ChoicePart,
  MatchArm,
  MatchPart,
  ValuePart,
} from "./ast";
import { HOLE } from "./normalise";
import { holeOutOfPlace, refuse } from "./errors";

/**
 * Reading one block: the CSS between `@@(` and its `)`, and the expressions carried inside it.
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
 * What opens a conditional group: `when $(cond) { … }`.
 *
 * **Not `if`, because CSS has an `if`.** `if()` is a value function in CSS Values 5 — shipped in
 * Chromium and WebKit, measured — so the same word would mean two things a line apart. `when` is not
 * CSS: there is a drafted `@when`, with its `@`, and no browser has it.
 *
 * The condition is `$( … )`, code, and nothing else: `when` and one escape. A bare `when { … }` is a
 * type selector for an element that cannot exist — a custom element's name must contain a hyphen —
 * so it is refused rather than compiled. Somebody who means that selector writes `& when { … }`.
 */
export const CONDITION = "when";

/**
 * What opens a lookup in a VALUE — `color: match $(this.variant) { … }`.
 *
 * Not a rule and not a condition: it stands where a value stands, and what it produces is one of the
 * values written inside it. See {@link MatchPart} for why that is the whole point.
 */
export const MATCH = "match";

/**
 * How code is entered: `$( … )`. Everything that is TypeScript in a block is inside one — a
 * condition, a `match` subject, a spread, a `@@property` or `@@keyframes` constant.
 *
 * **Not `{ … }`, which is CSS's block.** JSX enters code with braces, and a block is CSS, where a
 * brace opens a rule — so the same character meant both, and a reader could not tell `{this.x}` from
 * `&:hover {`. `$(` never occurs in CSS: `$` is no CSS character, and a `(` follows only a function's
 * name.
 */
export const ESCAPE = "$(";

/** Whether `$(` starts at `at` — the one test every reader of a block asks. */
export function opensCode(source: string, at: number): boolean {
  return source.charCodeAt(at) === 36 /* $ */ && source.charCodeAt(at + 1) === 40 /* ( */;
}

/** The word that opens a condition's other branches: `else when $( … ) { … }` and `else { … }`. */
export const ELSE = "else";
/** The head of a branch that has a condition of its own. */
const ELSE_CONDITION = `${ELSE} ${CONDITION}`;

/** A prelude that is TRYING to be a condition, well formed or not — the word and a boundary. */
const OPENS_A_CONDITION = new RegExp(`^(?:${ELSE}\\s+)?${CONDITION}\\b`);
/** A prelude that is trying to be a branch of one. */
const OPENS_A_BRANCH = new RegExp(`^${ELSE}\\b`);

/**
 * What a rule's prelude makes it in a chain of conditions, or nothing for every other rule.
 *
 * One definition, for the reason `holeIn` gives: the reader, the flattening, the rules and the
 * virtual file all ask it, and two answers to one question is where this package finds its faults.
 */
export function branchOf(
  prelude: string,
): { readonly kind: "when" | "else when"; readonly hole: number } | { readonly kind: "else" } | undefined {
  const when = holeIn(prelude, CONDITION);
  if (when !== undefined) return { kind: "when", hole: when };
  const otherwise = holeIn(prelude, ELSE_CONDITION);
  if (otherwise !== undefined) return { kind: "else when", hole: otherwise };
  return prelude.trim() === ELSE ? { kind: "else" } : undefined;
}
/** `match` and then its escape, which only a lookup has. */
const MATCH_HEAD = /^match\s*\$\(/;

/**
 * The spellings this language had before `$( … )`, named for what they became rather than left to
 * fail as something else. Nothing reads them: there is no second syntax, only a pointer.
 */
const OLD_CONDITION = /^(?:@@)?if\s*\(/;
const TO_CONDITION = "a condition is written `when $( … ) { … }` — `$( … )` is how code goes into a block.";
const TO_ESCAPE =
  "code goes into a block as `$( … )` — `{ … }` is CSS's own, the body of a rule. Write `$(…)` where the braces are.";
const TO_CHOICE =
  "a choice is written `$( … ) ? a : b` — a condition, `?`, the value when it holds, `:`, the value when it " +
  "does not. Both values are needed.";
const TO_BLOCK_MATCH =
  "a match is written `match $( … ) { key => ( … ); }` — the subject in `$( … )`, and every arm `key => ( … );`.";
const TO_ARM =
  "an arm is written `key => ( … );` — the declarations it applies in parens, as an arrow returns a value.";
const TO_ARM_END = "every arm ends with `;` — `key => ( … );`, then the next arm.";
const TO_ARM_BODY =
  "an arm holds declarations and nested rules, which are classes known when the block compiles — a condition, " +
  "a spread or another match cannot go in one. Write it beside the match instead.";
/**
 * A condition at the level that does not take it — the composing page's table: `when` chooses a
 * group and the choice chooses a value. Each names the spelling its level takes, rather than failing
 * as something else (`color` not accepting `when`, a hole as a declaration).
 */
const WHEN_IN_A_VALUE = /^when\s*\$\(/;
const TO_VALUE_CHOICE = "`when` chooses a group — for a value, write `$(c) ? a : b`.";
const TO_GROUP_WHEN = "a choice picks a value — for a group, write `when $(c) { … } else { … }`.";
/** What opens a block-level match: the word, alone, at the start of an item. */
const OPENS_A_BLOCK_MATCH = new RegExp(`^${MATCH}(?![\\w-])`);
const TO_BRANCH_PLACE =
  "an `else` belongs right after a `when $( … ) { … }` or an `else when $( … ) { … }` — it is the " +
  "rest of that choice, so it cannot start one, follow a declaration or a selector, or come after a final `else`.";
const TO_ELSE_CONDITION =
  "`else` takes no condition of its own — a branch with one is written `else when $( … ) { … }`.";
/** A condition is `when` and ONE escape, and nothing else. */
const TO_ONE_CONDITION =
  `\`${CONDITION}\` takes one \`$( … )\` and nothing else — everything the condition needs goes ` +
  "inside it, where it is ordinary TypeScript. To select an element named " +
  `\`${CONDITION}\` instead, name the parent: \`& ${CONDITION} { … }\`.`;
const LONE_DOLLAR = "a `$` on its own names nothing — write `$group.name` for a token, or `$( … )` for code.";
const TO_VARIABLE = (path: string) =>
  `a token is written \`$${path}\` — the group's name right after the \`$\`. \`$( … )\` is code.`;

/** What opens a spread of another block's map. */
export const SPREAD = "...";

/**
 * The hole index a composition marker's head holds — `@@if $(c)`, `...$(base)` — or nothing.
 *
 * One definition, because two readers of one syntax is where this package keeps finding faults: the
 * transform, the virtual file and the rules all ask this and must agree. The marker and one hole and
 * nothing else — `@@iffy $(c)` is not a condition and `... $(a) $(b)` is not a spread, so both
 * fall through to being read as what they look like and are refused there.
 */
export function holeIn(head: string, marker: string): number | undefined {
  const found = headPattern(marker).exec(head);
  return found === null ? undefined : Number(found[1]);
}

/**
 * The pattern for one marker, compiled once: `holeIn` runs for every head of every block, and
 * compiling per call was 5.6% of a build in `scripts/css/bench-css.mjs`.
 */
const headPatterns = new Map<string, RegExp>();
function headPattern(marker: string): RegExp {
  let pattern = headPatterns.get(marker);
  if (pattern === undefined) {
    // The escape brings its own parentheses, so neither marker wraps it in more: `when $(on)` and
    // `...$(base)`.
    const escaped = marker === SPREAD ? "\\.\\.\\." : marker.replace(" ", "\\s+");
    pattern = new RegExp(`^\\s*${escaped}\\s*${HOLE}(\\d+)${HOLE}\\s*$`);
    headPatterns.set(marker, pattern);
  }
  return pattern;
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
 * Three readers want this — the two in `references.ts` that only need a site's NAME, and the loop
 * in `transform.ts` that carries an imported module's rule across. None of them has a filename it
 * could honour — the first two have none, and the third holds the IMPORTING file's — so a refusal
 * from them names no file, or the wrong one: measured, a NUL in a `@@property` block came out of a
 * build as `:1:36 a NUL character cannot be written…`, ahead of the read that would have named the
 * right one.
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

/**
 * What a segment of a `$` path may hold.
 *
 * Letters, digits, `_` and `-`. Digits FIRST is the case that matters: `2xl` and `0` are ordinary
 * names in a design system, and the block is this package's grammar, so they are writable here. The
 * virtual file is the only place that must be TypeScript, and it spells such a segment with
 * brackets — measured, `$space.inline.2xl` does not parse as TypeScript and `["2xl"]` does.
 */
function isPathCharacter(code: number): boolean {
  return (
    (code >= 97 && code <= 122) /* a-z */ ||
    (code >= 65 && code <= 90) /* A-Z */ ||
    (code >= 48 && code <= 57) /* 0-9 */ ||
    code === 45 /* - */ ||
    code === 95 /* _ */
  );
}

const PAREN = 41; /* ) */
const BRACE = 125; /* } */
const BRACE_OPEN = 123; /* { */

/**
 * Where the hole opening at `at` closes — the offset of its `}}` — or -1 when it never does.
 *
 * **It cannot be `indexOf("}}")`**, and that is the whole reason this is a function. The inside of
 * a hole is JavaScript, so `{{ pick({ on: "}}" }) }}` ends at the LAST `}}` and not the first, and
 * `{{ {a: {b: 1}}.a.b }}` has one in the middle of an object literal. Braces, parens, brackets,
 * strings, templates, comments and REGEX LITERALS are all counted — `{s.replace(/}/g, "")}` holds a
 * `}` that closes nothing.
 *
 * Telling a regex from a division does not need a JavaScript lexer: it needs the PREVIOUS
 * SIGNIFICANT TOKEN, which is a closed question. After a name, a number, `)`, `]`, `}` or a
 * `++`/`--`, a `/` divides. After anything else — an operator, `(`, `[`, `,`, `:`, the start, or
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
 * the rule that looks for a `//` — and an `indexOf` in any of them cuts a hole holding an object
 * literal in half.
 */
export function closingHole(source: string, at: number): number {
  let index = at + 1;
  let depth = 0;
  /**
   * What closes it: a `)` for the `(` of `$( … )`, which is how code is entered now, and a `}` for a
   * `{ … }` the formatter still walks — a `match` body.
   */
  const closer = source.charCodeAt(at) === 40 /* ( */ ? PAREN : BRACE;
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
    } else if (code === PAREN && closer === PAREN && depth === 0) {
      return index + 1;
    } else if (code === 41 /* ) */ || code === 93 /* ] */) {
      depth--;
      divides = true;
    } else if (code === BRACE && closer === BRACE) {
      // Just PAST the closer, so no caller has to know how long the closer is.
      if (depth === 0) return index + 1;
      depth--;
      divides = true;
    } else if (code === BRACE) {
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
 * The CSS rules have a helper of this name that includes `-`, because a CSS property holds one.
 * Here a `-` is subtraction, and reading it as part of a name would make `a-b` end in a value and
 * turn the `/` after it into a division when it is one — right by accident — while `x /re/` after a
 * minus would go the other way. Its own function rather than the shared one, and this is the note
 * that says the difference was chosen.
 *
 * `$` and `_` are name characters; a digit is not a name START but this is only ever asked of a
 * run.
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
 * A property name, a colon, and then either a space or the end of the text.
 *
 * **The space is load-bearing.** A bare type selector is a legal prelude — `a:hover { … }` parses —
 * and it begins with a property-shaped name and a colon exactly like `border: 4px solid` does. What
 * separates them is that a declaration's colon is followed by whitespace or by the value itself,
 * and a pseudo-class's is followed immediately by its own name. So `a:hover` is a selector,
 * `color:{accent}` is a value, and `border: 4px solid {accent}` is a value — measured against every
 * prelude in this repository and the four bare-type-selector shapes the parser accepts.
 *
 * **The NAME is every name CSS allows.** A vendor prefix is ordinary CSS, so requiring an ASCII
 * letter first would read `-webkit-mask: {m}` as a nested rule. A custom property is `--` and then
 * anything a name may hold (`--2x`, `--_x`, `--héllo`), and any other property is an optional
 * single dash, then a letter, an underscore or a non-ASCII character, then name characters. This
 * regex is only consulted where a `{` follows, so a name it gets wrong still parses with an
 * ordinary value — which is how such a fault hides.
 *
 * What it decides: a `{` after a head of this shape belongs to the VALUE — a `match` body — and not
 * to a rule. See `looksLikeARule`.
 */
const A_DECLARATION =
  /^\s*(?:--(?:[\w-]|[\u0080-\uFFFF])+|-?(?:[a-zA-Z_]|[\u0080-\uFFFF])(?:[\w-]|[\u0080-\uFFFF])*)\s*:(\s|$)/;

/**
 * The message for a call left open in a declaration already read, or nothing.
 *
 * Asked only when a refusal is about to happen: a block that reads has nothing to explain, and this
 * walks what was read rather than the source. `unclosedCall` in the rules is the tolerant half and
 * says the same thing to an editor — the wording lives there, and is repeated here rather than
 * imported because the rules import this module and the cycle would be the worse trade.
 */
function unclosedAbove(items: readonly BlockItem[]): { at: number; message: string } | undefined {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item.kind !== "declaration") continue;

    let depth = 0;
    let name = "";
    let opens: number | undefined;
    for (const part of item.value) {
      if (part.kind !== "text" || part.at === undefined) continue;
      const text = part.text;
      for (let at = 0; at < text.length; at++) {
        const code = text.charCodeAt(at);
        if (code === 34 || code === 39) {
          at = endOfQuoted(text, at);
          continue;
        }
        if (code === 59 /* ; */) break;
        if (code === 40) {
          let from = at;
          while (from > 0 && /[\w-]/.test(text[from - 1] ?? "")) from--;
          name = `${text.slice(from, at)}(`;
          opens = part.at + from;
          depth++;
        } else if (code === 41) depth--;
      }
    }

    if (depth <= 0 || opens === undefined) return undefined;
    return {
      at: opens,
      message:
        `\`${name}\` is never closed — it needs a \`)\`.\n\n        Until it is, the value runs past the ` +
        `end of the block, and what gets reported is\n        whatever your own code says after it.`,
    };
  }
  return undefined;
}

/** Where a quoted run ends, so a `(` or `)` inside one is text rather than structure. */
function endOfQuoted(text: string, start: number): number {
  const quote = text.charCodeAt(start);
  for (let index = start + 1; index < text.length; index++) {
    if (text.charCodeAt(index) === 92) {
      index++;
      continue;
    }
    if (text.charCodeAt(index) === quote) return index;
  }
  return text.length;
}

/**
 * What a `//` inside a block is, in one sentence — said by the `line-comment` RULE and by the
 * parser's refusal, which are two paths to the same fault.
 *
 * Here rather than in the rules because they already import from this file and the reverse would be
 * a cycle. One sentence in one place, so the two cannot drift.
 */
export const LINE_COMMENT =
  "CSS has no `//` comment — this and the rest of the line are written into the stylesheet, " +
  "and the build refuses the file. Write `/* … */`.";

export function readBlock(source: string, open: number, filename: string, options: ReadOptions = {}): ReadBlock {
  const tolerant = options.tolerant === true;
  const resolve = options.resolve;
  const holes: Span[] = [];
  /**
   * A literal `U+0000`, refused before anything is read.
   *
   * `normalise` builds the hole placeholder out of this character. CSS preprocessing would turn a
   * NUL into U+FFFD, but a block is read out of a TYPESCRIPT file, where nothing preprocesses it as
   * CSS — measured, a block carrying two of them shared an identity, and a class, with a block
   * carrying a real hole. Refused rather than escaped, because it is a control character with no
   * meaning in CSS: there is nothing to preserve, and refusing keeps the placeholder unforgeable by
   * construction.
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
   * Past one escape, `$( … )`, recording its expression, and returns the part that stands for it.
   *
   * `at` is on the `$`. The end is the `)` at depth zero **in the expression's own grammar** —
   * brackets, strings, templates, regexes and comments all counted — see {@link closingHole}.
   */
  function pastHole(): ValuePart {
    /** Where the `$` itself is, before `at` moves past the escape. */
    const opens = at;
    const start = at + 2;
    /** Just past the `)` — see {@link closingHole}. */
    const close = closingHole(source, at + 1);

    if (close === -1 && !tolerant) {
      refuse("this `$(` is never closed — it needs a `)`.", source, at, filename);
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
      // the field's own note.
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

  /**
   * `match $(subject) { key => value; … }`, read from the `m`.
   *
   * Tolerant throughout, because an editor sees this half-written more often than finished: a
   * missing brace, an arm with no `=>`, a key and nothing after it. Every one of those ends the read
   * with what was understood so far, and the rules say what is wrong — a refusal here would take the
   * whole file's completions away while somebody is still typing the second arm.
   */
  function readMatch(): MatchPart {
    const opens = at;
    at += MATCH.length;
    skipTrivia();

    /**
     * The subject is a HOLE in the reader's numbering, which is how its expression reaches the
     * emit. It is not a hole in the sense the value rules mean — it chooses a class, it does not
     * carry a value onto an element — and `MatchPart` says so where a reader will look.
     */
    let hole = holes.length;
    if (opensCode(source, at)) {
      const read = pastHole();
      if (read.kind === "hole") hole = read.index;
    }
    skipTrivia();
    if (source.charCodeAt(at) === 123 /* { */) at++;

    const arms: MatchArm[] = [];
    for (;;) {
      skipTrivia();
      if (at >= source.length) break;
      if (source.charCodeAt(at) === 125 /* } */) {
        at++;
        break;
      }

      const keyAt = at;
      const key = readArmKey();
      if (key === undefined) break;

      skipTrivia();
      if (source.startsWith("=>", at)) at += 2;
      // An arm is a value known when the block compiles, so a choice is not read in one: its
      // condition stays a runtime value in the arm, which `hole-in-a-match-arm` reports.
      const value = readValue(125 /* } */, false, true);
      if (source.charCodeAt(at) === 59 /* ; */) at++;

      arms.push({ key, otherwise: key === "_", value, at: keyAt, length: at - keyAt });
    }

    return { kind: "match", hole, arms, at: opens, length: at - opens };
  }

  /**
   * An arm's key: a quoted string, or everything up to the arrow.
   *
   * Quoted for what is not an identifier, bare for what is — the distinction CSS already makes, and
   * the one an author will reach for without being told.
   */
  function readArmKey(): string | undefined {
    if (source.charCodeAt(at) === 34 || source.charCodeAt(at) === 39) {
      const start = at;
      pastString();
      return source.slice(start + 1, at - 1);
    }
    const from = at;
    while (at < source.length) {
      const code = source.charCodeAt(at);
      if (code === 61 /* = */ || code === 59 /* ; */ || code === 125 /* } */ || code === 10) break;
      at++;
    }
    const written = source.slice(from, at).trim();
    return written === "" ? undefined : written;
  }

  /**
   * `match $(subject) { key => ( … ); … }` at the head of an item — a match whose arms are groups.
   *
   * The arms are read the way a value match's are, the key by the same function, and each arm's body
   * by `readItems` as any group of declarations is: an arm IS one, closed by a paren instead of a
   * brace. What an arm may hold is checked here, because the emit picks an arm's classes in one
   * lookup and a condition or a spread inside one would have nothing to stand on.
   */
  function readBlockMatch(): BlockMatch {
    const opens = at;
    at += MATCH.length;
    skipTrivia();

    let hole = holes.length;
    if (opensCode(source, at)) {
      const read = pastHole();
      if (read.kind === "hole") hole = read.index;
    } else if (!tolerant) refuse(TO_BLOCK_MATCH, source, opens, filename);
    skipTrivia();
    if (source.charCodeAt(at) === BRACE_OPEN) at++;
    else if (!tolerant) refuse(TO_BLOCK_MATCH, source, opens, filename);

    const arms: BlockArm[] = [];
    for (;;) {
      skipTrivia();
      if (at >= source.length) {
        if (!tolerant) refuse("this match is never closed — its arms need a `}` after them.", source, opens, filename);
        break;
      }
      if (source.charCodeAt(at) === BRACE) {
        at++;
        break;
      }

      const keyAt = at;
      const key = readArmKey();
      if (key === undefined) {
        if (!tolerant) refuse(TO_ARM, source, keyAt, filename);
        at++;
        continue;
      }
      skipTrivia();
      if (source.startsWith("=>", at)) at += 2;
      else if (!tolerant) refuse(TO_ARM, source, keyAt, filename);
      skipTrivia();
      if (source.charCodeAt(at) !== 40 /* ( */) {
        if (!tolerant) refuse(TO_ARM, source, keyAt, filename);
        // Forgiving: what follows is not an arm body, so the match ends where it stopped making sense.
        break;
      }
      at++;
      const inside = readItems(PAREN);
      if (!tolerant) {
        const composed = compositionIn(inside);
        if (composed !== undefined) refuse(TO_ARM_BODY, source, composed, filename);
      }
      skipTrivia();
      if (source.charCodeAt(at) === 59 /* ; */) at++;
      else if (!tolerant) refuse(TO_ARM_END, source, at, filename);

      arms.push({ key, otherwise: key === "_", at: keyAt, length: at - keyAt, items: inside });
    }

    return { kind: "match", at: opens, end: at, hole, arms };
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
     * Not `source.slice(at, index)`: `readHead` collapses every comment to one space before asking
     * the same question, so the raw slice disagreed wherever a comment sat near a colon — one
     * between a property and its colon was a rule to the lookahead and a hole to the reader, and a
     * legal declaration was refused as a hole in a selector.
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
       * A comment, read here as `skipTrivia`, `readHead` and `readValue` read it. Unread, a `;`, a
       * `(` or a `)` inside a prelude's comment ends this scan: a prelude carrying a commented-out
       * `focus;` was read as a declaration whose value was the rule's body, and the module that
       * came out was a syntax error at no line the author had written.
       *
       * One space, for the reason `readHead` gives: a comment separates tokens, and joining `1px`
       * to `2px` would make one value out of two.
       */
      if (code === 47 /* / */ && source.charCodeAt(index + 1) === 42) {
        const close = source.indexOf("*/", index + 2);
        index = close === -1 ? source.length : close + 2;
        head += " ";
        continue;
      }
      // An escape is stepped over whole: whatever its code holds — a `;`, a `{` — is TypeScript's.
      if (opensCode(source, index)) {
        const mark = at;
        at = index;
        pastHoleWithoutRecording();
        head += source.slice(index, at);
        index = at;
        at = mark;
        continue;
      }
      if (code === 123 /* { */ && depth === 0) {
        /**
         * Inside a DECLARATION a `{` is a `match` body — `color: match $(t) { … }` — and it is
         * stepped over whole, so the value's own `;` decides. The head already reads `property: `,
         * which no selector can: see {@link A_DECLARATION}. Anywhere else a `{` opens a rule.
         */
        if (A_DECLARATION.test(head)) {
          const close = closingHole(source, index);
          head += source.slice(index, close === -1 ? source.length : close);
          index = close === -1 ? source.length : close;
          continue;
        }
        return true;
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
  /** Whether the hole at `at` is followed by `?`, which makes the item a choice. Moves nothing. */
  function choiceOverGroups(): boolean {
    const mark = at;
    pastHoleWithoutRecording();
    skipTrivia();
    const choice = source.charCodeAt(at) === 63; /* ? */
    at = mark;
    return choice;
  }

  /**
   * Past one item a forgiving read gives up on: to the `;` that ends it, or to the bracket that
   * closes what holds it. Strings and comments are not read — it only has to land somewhere sane.
   */
  function pastItem(): void {
    let depth = 0;
    while (at < source.length) {
      const code = source.charCodeAt(at);
      if (code === 40 || code === 91 || code === 123) depth++;
      else if (code === 41 || code === 93 || code === 125) {
        if (depth === 0) return;
        depth--;
      } else if (code === 59 && depth === 0) {
        at++;
        return;
      }
      at++;
    }
  }

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
      if (opensCode(source, at)) {
        /**
         * The one escape that MAY stand in a property name: a reference to a registered property,
         * which is a name this compiler generated and the author has no other way to write.
         * `$(angle): 45deg` is how a `@@property( … )` is set, and without it registering one is
         * only half a feature — nothing else can name it.
         */
        const close = closingHole(source, at + 1);
        const written = close === -1 ? undefined : resolve?.(source.slice(at + 2, close - 1).trim());
        if (written !== undefined) {
          text += written;
          at = close;
          continue;
        }

        /**
         * The two heads that ARE an expression rather than a name: `when $(cond)` and `...$(block)`.
         * Recorded like any other escape, so the transform leaves the author's expression exactly
         * where they wrote it, and marked in the text with the placeholder a value uses.
         *
         * Whitespace between the marker and the escape is free, as everywhere else in a block.
         */
        const head = text.trim().replace(/\s+/g, " ");
        if (!tolerant && head === ELSE) refuse(TO_ELSE_CONDITION, source, from, filename);
        if (head === CONDITION || head === ELSE_CONDITION || head === SPREAD) {
          const part = pastHole();
          // A part that came back as TEXT is a reference to a named site, resolved at build time —
          // a `@@keyframes` name, which is a string and not a condition or a block. It falls
          // through to the refusal below, which is the right answer for it.
          if (part.kind === "hole") {
            text += `${HOLE}${part.index}${HOLE}`;
            continue;
          }
        }

        if (!tolerant && OPENS_A_CONDITION.test(head)) refuse(TO_ONE_CONDITION, source, from, filename);
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

  /**
   * `$` group ( `.` segment )* — the path, from the `$` to wherever it stops being one. The group is
   * the config's own name, right after the `$`: `$color.line`.
   *
   * A segment is `[A-Za-z0-9_-]`, which admits `2xl` and `0` deliberately: the block is this
   * package's grammar, so a design system's own names are writable here. Only the VIRTUAL file has
   * to be TypeScript, and it spells such a segment with brackets.
   *
   * A trailing dot is kept in neither the path nor the span's exclusion — `$color.` reads as
   * `color` with the dot inside the span, because that is the caret position completion is asked
   * about.
   */
  function pastVariable(): ValuePart {
    const start = at;
    at += 1; // `$`

    const segments: string[] = [];
    for (;;) {
      const from = at;
      while (at < source.length && isPathCharacter(source.charCodeAt(at))) at++;
      if (at > from) segments.push(source.slice(from, at));
      if (source.charCodeAt(at) === 46 && at + 1 < source.length) {
        at++;
        continue;
      }
      break;
    }

    const open = source.charCodeAt(at - 1) === 46 ? ({ open: true } as const) : undefined;
    return { kind: "variable", path: segments.join("."), at: start, length: at - start, ...open };
  }

  /** A declaration's value: text and holes, up to `;` or whatever closes the block it is in. */
  /**
   * Whether a value starting at `at` is a CHOICE: an escape, and a `?` right after it. CSS has no
   * `?` in a value, so nothing a stylesheet can hold is read as one.
   */
  function opensAChoice(from: number): boolean {
    if (!opensCode(source, from)) return false;
    let index = closingHole(source, from + 1);
    if (index === -1) return false;
    // Whitespace and comments, as everywhere a block reads: `$(on) /* why */ ? red : blue`.
    for (;;) {
      while (index < source.length && isSpace(source.charCodeAt(index))) index++;
      if (source.startsWith("/*", index)) {
        const close = source.indexOf("*/", index + 2);
        if (close === -1) return false;
        index = close + 2;
        continue;
      }
      break;
    }
    return source.charCodeAt(index) === 63 /* ? */;
  }

  /**
   * `$(a) ? x : $(b) ? y : z`, read whole. A branch after `?` runs to the `:` at its top level, and
   * the last one, after `:`, to the `;`. A branch written in parens is the same value — the
   * formatter takes them off — and a function like `rgb(1 2 3)` is not a branch in parens.
   */
  function readChoice(closer: number): ChoicePart {
    const opens = at;
    const branches: ChoiceBranch[] = [];
    let otherwise: ValuePart[] = [];

    for (;;) {
      const branchAt = at;
      const condition = pastHole();
      if (condition.kind !== "hole" && !tolerant) refuse(TO_CHOICE, source, branchAt, filename);
      skipTrivia();
      at++; // the `?`, which `opensAChoice` saw
      skipTrivia();
      const value = branchValue(closer, true);
      if (!tolerant && (value.length === 0 || source.charCodeAt(at) !== 58))
        refuse(TO_CHOICE, source, branchAt, filename);
      branches.push({
        hole: condition.kind === "hole" ? condition.index : holes.length,
        value,
        at: branchAt,
        length: at - branchAt,
      });
      if (source.charCodeAt(at) !== 58 /* : */) break;
      at++;
      skipTrivia();
      if (opensAChoice(at)) continue;
      otherwise = branchValue(closer, false);
      if (!tolerant && otherwise.length === 0) refuse(TO_CHOICE, source, opens, filename);
      break;
    }

    return { kind: "choice", branches, otherwise, at: opens, length: at - opens };
  }

  /** One branch's value — the inside of its parens when the whole branch is in a pair of them. */
  function branchValue(closer: number, toColon: boolean): ValuePart[] {
    if (source.charCodeAt(at) === 40 /* ( */) {
      const mark = at;
      at++;
      const inside = readValue(PAREN, false, true);
      if (source.charCodeAt(at) === PAREN) {
        at++;
        skipTrivia();
        const next = source.charCodeAt(at);
        if (next === (toColon ? 58 : 59) || (!toColon && next === closer)) return inside;
      }
      at = mark;
    }
    return readValue(closer, toColon, true);
  }

  function readValue(closer: number, toColon = false, inABranch = false): ValuePart[] {
    /**
     * A value that IS a lookup, read whole before anything else is tried.
     *
     * It has to be the whole value rather than a part of one: `1px solid match(…) { … }` would put
     * a brace-delimited list inside a value that is otherwise read character by character, and the
     * arms would have to be found by counting braces past a value that may hold its own. Requiring
     * it to stand alone costs an author nothing — an arm holds a whole value, so `1px solid red` is
     * written in the arm.
     */
    {
      const mark = at;
      skipTrivia();
      const found = MATCH_HEAD.exec(source.slice(at));
      if (found !== null) return [readMatch()];
      if (WHEN_IN_A_VALUE.test(source.slice(at))) {
        if (!tolerant) refuse(TO_VALUE_CHOICE, source, at, filename);
        /**
         * Forgiving, the value is read to its end and kept as NOTHING. What it holds is not a value at
         * all, so every rule that read it would say something beside the point — `color` not taking
         * the word `when`, a runtime value in a declaration — and cover the character the build's own
         * sentence stands on. With nothing kept, `block-refused` says that sentence alone.
         */
        at += "when".length;
        readValue(closer, toColon, true);
        return [];
      }
      // A choice inside a branch would leave its `:` to the branch around it: read as a hole, it is
      // refused there by `hole-in-a-match-arm` rather than misread.
      if (!inABranch && opensAChoice(at)) return [readChoice(closer)];
      at = mark;
    }

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
      /**
       * `$color.primary.main` — a declared variable, at any depth, so `calc($size.md * 2)` works.
       *
       * The group's name follows the `$` directly, so a `$` and then a letter or `_` is a variable,
       * and a `$` and then `(` is code. A `$` before anything else is ordinary text. A trailing dot
       * with nothing after it is kept in the path's span — see `VariablePart.path` for why that is
       * what an editor needs.
       */
      if (code === 36 && isNameStart(source.charCodeAt(at + 1))) {
        flush();
        parts.push(pastVariable());
        textAt = at;
        continue;
      }
      /**
       * A `$` and nothing a name could be yet — the caret right after it, in an editor. Read as a
       * variable with an empty path, so the virtual file asks TypeScript for the groups there.
       * A build refuses it: CSS has no use for a `$` outside a string, so one alone is a name or an
       * escape not finished.
       */
      if (code === 36 && !opensCode(source, at) && source.charCodeAt(at + 1) !== 46) {
        if (!tolerant) refuse(LONE_DOLLAR, source, at, filename);
        flush();
        parts.push({ kind: "variable", path: "", at, length: 1, open: true });
        at++;
        textAt = at;
        continue;
      }
      // The spelling a variable had before: named, not read.
      if (code === 36 && source.charCodeAt(at + 1) === 46 && !tolerant) {
        const path = /^\$\.([\w.-]*)/.exec(source.slice(at))?.[1] ?? "";
        refuse(TO_VARIABLE(path), source, at, filename);
      }
      // A `{` in a value is not CSS, and it is how code was entered before `$( … )`.
      if (code === 123 && !tolerant) refuse(TO_ESCAPE, source, at, filename);
      if (opensCode(source, at)) {
        flush();
        parts.push(pastHole());
        /**
         * The run AFTER a hole starts after the hole, not where the hole did.
         *
         * `flush` moves the mark to `at`, and at that moment `at` is the `$` — so without this the
         * trailing run of `4px solid {w} inset` would record the hole's own offset. Two runs
         * claiming one position breaks the reverse lookup: it sorts by author offset, the trailing
         * run sorts before the hole between them, and every author offset past the first hole in a
         * value maps nowhere. Measured by sweeping every offset in a block through it and back.
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
      if (depth === 0 && (code === 59 || code === closer || (toColon && code === 58))) break;

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
        if (!tolerant) refuse("this block is never closed — a `@@(` needs a `)`.", source, open, filename);
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

      // A `{` where an item starts is how a property name took code before `$( … )`.
      if (!tolerant && source.charCodeAt(at) === 123) refuse(TO_ESCAPE, source, at, filename);

      /**
       * The spellings this had before `$( … )`, named rather than left to fail as something else —
       * asked of the source before the head is read, because the old `when $(on)` has an escape
       * where the reader refuses one and would name that instead.
       */
      if (!tolerant && OLD_CONDITION.test(source.slice(at, at + 16))) refuse(TO_CONDITION, source, at, filename);

      /**
       * A choice written over groups — `$(c) ? ( … ) : ( … );` — refused with the spelling a group
       * takes. Forgiving, the whole item is passed over and nothing recorded: read as a property
       * whose name holds a hole, it drew two reports beside the point and covered the character the
       * build's own sentence stands on.
       */
      if (source.startsWith(ESCAPE, at) && choiceOverGroups()) {
        if (!tolerant) refuse(TO_GROUP_WHEN, source, at, filename);
        pastItem();
        continue;
      }

      // A forgiving read waits for the subject: until `$(` follows, `match` is a word being typed,
      // and a match with no subject would hand every reader below an index nothing holds.
      if (
        OPENS_A_BLOCK_MATCH.test(source.slice(at, at + MATCH.length + 1)) &&
        (!tolerant || MATCH_HEAD.test(source.slice(at)))
      ) {
        items.push(readBlockMatch());
        continue;
      }

      if (looksLikeARule(closer)) {
        const prelude = readHead(123 /* { */, "a selector").trim();

        /**
         * A branch stands right after the `when` or `else when` it continues — comments between
         * them are not items, so they do not part the two — and nowhere else.
         */
        if (!tolerant && OPENS_A_BRANCH.test(prelude)) {
          if (!/^else\s+when\b/.test(prelude) && prelude !== ELSE) refuse(TO_ELSE_CONDITION, source, from, filename);
          const before = items[items.length - 1];
          const continues = before?.kind === "rule" && branchOf(before.prelude)?.kind.endsWith("when") === true;
          if (!continues) refuse(TO_BRANCH_PLACE, source, from, filename);
        }

        // The old `...$(base)` reaches here because its `{` opens a rule.
        if (!tolerant && prelude === SPREAD) refuse(TO_ESCAPE, source, from, filename);

        /**
         * A condition is `when` and ONE escape, and nothing else.
         *
         * A hole is let into a prelude only when the text so far is exactly the marker, and after
         * recording it the read carries on — so without this, anything written after it joined the
         * prelude as ordinary text and compiled.
         */
        const branch = branchOf(prelude);
        if (OPENS_A_CONDITION.test(prelude) && (branch === undefined || branch.kind === "else") && !tolerant) {
          refuse(TO_ONE_CONDITION, source, from, filename);
        }
        // `readHead` stopped on the `{` the lookahead found, so this cannot be anything else.
        at++;
        items.push({ kind: "rule", at: from, preludeEnd: at - 1, prelude, items: readItems(BRACE) });
        continue;
      }

      const property = readHead(58 /* : */, "a property name").trim();
      if (at >= source.length || source.charCodeAt(at) !== 58) {
        /**
         * A spread has no value, and that is what it IS: `...$(base);` merges another block's map
         * at this point rather than setting anything. It reaches here because it has no colon —
         * which for everything else is the missing half of a declaration.
         */
        if (isSpread(property)) {
          if (at < source.length && source.charCodeAt(at) === 59) at++;
          items.push({ kind: "declaration", at: from, end: at, property, value: [] });
          continue;
        }

        if (!tolerant) {
          /**
           * **A `//` comment, named as one**, so the build and the editor say the same thing.
           *
           * A line comment is normally absorbed into the NEXT declaration's key, so the block still
           * parses and `line-comment` reports it with the sentence that says what to do. When it is
           * the last thing in a block there is no next declaration, so this refusal runs first —
           * and without this the editor would say `CSS has no \`//\` comment` and the build *"`//
           * last` is not a declaration"*. Both true, one useless.
           *
           * The rule's own words rather than a second wording of them: one sentence, one place.
           */
          /**
           * A declaration ABOVE this one holding a call nothing closed, which is why this line is
           * being read as a property at all.
           *
           * `content: url(;` runs past `)}` — the value scanner counts parens and a block's closer
           * is a `)` like any other — so the author's own next line arrives here and is refused for
           * not being a declaration. Measured, `const d = (1 + 2);` was reported on line 4 for a
           * mistake on line 2.
           *
           * `unclosed-call` has the sentence that names the real fault, and never got to say it:
           * this refusal runs first and nothing checks a block that would not read. So the refusal
           * carries the rule's words, which is what `//` beside it already does — one sentence, one
           * place.
           */
          const dangling = unclosedAbove(items);

          refuse(
            dangling !== undefined
              ? dangling.message
              : property.trimStart().startsWith("//")
                ? LINE_COMMENT
                : `\`${property.trim()}\` is not a declaration — a block holds \`property: value;\` and nested rules, nothing else.`,
            source,
            // `from`, not `at - property.length`: the name is trimmed, so measuring its length back
            // from a position past the whitespace pointed one column further right for every space
            // after it. `disp ` reported column 6 for a word beginning at 5.
            //
            // And the CALL's own position when one is dangling: the fault is where the `(` is, not
            // where the value happened to run out. Measured, it read line 4 for a mistake on line 2.
            dangling?.at ?? from,
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
       * Accepted, it emits `.r-x { color:; }` — a declaration no browser accepts, on a class still
       * written into the markup, so the element carries a rule that does nothing.
       *
       * Refused only in the strict read, because a value with nothing typed yet is the state an
       * editor is in most: the tolerant read keeps the declaration so the caret has a value
       * position to complete in.
       */
      if (!tolerant && value.length === 0) {
        refuse(`\`${property.trim()}\` has no value — a declaration is \`property: value;\`.`, source, from, filename);
      }
      const terminated = at < source.length && source.charCodeAt(at) === 59;
      if (terminated) at++;
      items.push({
        kind: "declaration",
        at: from,
        valueAt,
        end,
        property,
        value,
        ...(terminated ? ({ terminated: true } as const) : undefined),
      });
    }
  }

  const items = readItems(PAREN);
  return { block: { items }, holes, end: at - 1 };
}

/**
 * Where the first piece of composition in an arm's items stands — a condition or its branch, a
 * spread, a match at either level, a choice — or nothing.
 */
function compositionIn(items: readonly BlockItem[]): number | undefined {
  for (const item of items) {
    if (item.kind === "match") return item.at ?? 0;
    if (item.kind === "rule") {
      if (branchOf(item.prelude) !== undefined) return item.at ?? 0;
      const inner = compositionIn(item.items);
      if (inner !== undefined) return inner;
      continue;
    }
    if (isSpread(item.property)) return item.at ?? 0;
    // A choice is a condition too, and has nowhere to be written inside an arm's classes.
    if (item.value.some((part) => part.kind === "match" || part.kind === "choice")) return item.valueAt ?? item.at ?? 0;
  }
  return undefined;
}

/** What a variable's group may start with: a letter or `_` — never a digit, never `(`. */
function isNameStart(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95;
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
