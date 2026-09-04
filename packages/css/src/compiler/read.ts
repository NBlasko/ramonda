import type { Block, BlockItem, ValuePart } from "./ast";
import { refuse } from "./errors";

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
 */
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

export function readBlock(source: string, open: number, filename: string): ReadBlock {
  const holes: Span[] = [];
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
    const start = at + 2;
    let index = start;
    let depth = 0;

    while (index < source.length) {
      const code = source.charCodeAt(index);

      if (code === 34 /* " */ || code === 39 /* ' */ || code === 96 /* ` */) {
        index = pastExpressionString(source, index);
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
      }
      if (code === 123 /* { */ || code === 40 /* ( */ || code === 91 /* [ */) depth++;
      else if (code === 41 /* ) */ || code === 93 /* ] */) depth--;
      else if (code === BRACE) {
        if (depth === 0 && source.charCodeAt(index + 1) === BRACE) {
          const part: ValuePart = { kind: "hole", index: holes.length };
          holes.push({ start, end: index });
          at = index + 2;
          return part;
        }
        depth--;
      }
      index++;
    }

    refuse("this hole is never closed — a `{{` needs a `}}`.", source, at, filename);
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

    while (index < source.length) {
      const code = source.charCodeAt(index);

      if (code === 34 || code === 39) {
        const mark = at;
        at = index;
        pastString();
        index = at;
        at = mark;
        continue;
      }
      if (code === 123 /* { */) {
        if (source.charCodeAt(index + 1) === 123) {
          const mark = at;
          at = index;
          pastHoleWithoutRecording();
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
        index++;
        continue;
      }
      if (code === PAREN) {
        if (depth === 0) return false;
        depth--;
        index++;
        continue;
      }
      if (depth === 0 && (code === 59 /* ; */ || code === closer)) return false;
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
  function readHead(stopAt: number, what: "selector" | "property"): string {
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
      if (code === 123 && source.charCodeAt(at + 1) === 123) {
        refuse(
          at === from
            ? "a hole cannot be a whole declaration — a custom property holds a value, so write `property: {{…}}` and put the choice inside it."
            : `a hole cannot stand in a ${what} — a custom property holds a value, and a ${what} is not one.`,
          source,
          at,
          filename,
        );
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

    const flush = () => {
      if (text !== "") {
        parts.push({ kind: "text", text });
        text = "";
      }
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
      if (code === 123 && source.charCodeAt(at + 1) === 123) {
        flush();
        parts.push(pastHole());
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
        refuse("this block is never closed — a `@(` needs a `)`.", source, open, filename);
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
        const prelude = readHead(123 /* { */, "selector").trim();
        // `readHead` stopped on the `{` the lookahead found, so this cannot be anything else.
        at++;
        items.push({ kind: "rule", at: from, prelude, items: readItems(BRACE) });
        continue;
      }

      const property = readHead(58 /* : */, "property").trim();
      if (at >= source.length || source.charCodeAt(at) !== 58) {
        refuse(
          `\`${property.trim()}\` is not a declaration — a block holds \`property: value;\` and nested rules, nothing else.`,
          source,
          at - property.length,
          filename,
        );
      }
      at++;
      // Past the whitespace after the colon, so the value's position is the value and not the gap
      // before it. What `readValue` then collects has no leading whitespace, which normalisation was
      // going to trim anyway.
      while (at < source.length && isSpace(source.charCodeAt(at))) at++;
      const valueAt = at;
      const value = readValue(closer);
      if (at < source.length && source.charCodeAt(at) === 59) at++;
      items.push({ kind: "declaration", at: from, valueAt, property, value });
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
