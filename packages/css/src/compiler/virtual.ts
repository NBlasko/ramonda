import type { BlockItem, ValuePart } from "./ast";
import { CONDITION, SPREAD, holeIn } from "./read";
import { collapse } from "./normalise";
import type { Span } from "./read";
import { readBlock } from "./read";
import { findBlocks, mayHoldABlock } from "./scan";
import { namedSites } from "./references";

/**
 * The virtual file: the author's file as valid TSX, and the way back from a diagnostic to the
 * character they typed.
 *
 * This is the whole of the claim the package rests on — **a syntax TypeScript cannot parse can still
 * be fully type-checked**, as long as we own the step that turns it into TypeScript. It is the same
 * three moves `vue-tsc` and `svelte-check` make: write a virtual file, hand it to `tsc`, map each
 * diagnostic home.
 *
 * ## Two things go in, and the second is what makes CSS type-safe at all
 *
 * - **Each hole's expression, in its real lexical scope.** The expression stays inside the same JSX,
 *   in the same method, on the same class — so `this`, the imports and the generics are all what the
 *   author sees. Nothing is lifted out.
 * - **Each block as an object literal.** An object literal is what gets excess-property checking, and
 *   excess-property checking is what produces TypeScript's own *did you mean* on a CSS property name.
 *   Any other shape — a call with strings, a tagged template — throws that away.
 *
 * ```
 *   <div css=@@( display: flex; border-left: 4px solid {{this.accent}}; )>
 *
 *   <div css={__block({ "display":"flex", "border-left":`4px solid ${this.accent}` })}>
 * ```
 *
 * ## Two kinds of mapping, because only some of the text is the author's own
 *
 * The expressions and everything outside a block are **copied**, byte for byte, so a diagnostic
 * inside one maps offset by offset. A property name, a value and a selector are **rewritten** —
 * quoted, escaped, whitespace folded — so anything landing in one maps to where it STARTS. That is
 * the position the reader needs anyway: a *did you mean* about `dsiplay` belongs on `dsiplay`.
 *
 * Anything that maps nowhere is scaffolding, and a caller drops it: `__block` itself, the punctuation
 * between declarations, the preamble. Those diagnostics are about the file we wrote, not the one they
 * did.
 *
 * ## Line for line, which is not free and is worth it
 *
 * A multi-line block becomes ONE line — the whitespace between declarations is text this file never
 * emits — so every line after it moved up. Measured: a nine-line file became seven, and the preamble
 * added one at the top, so a consumer counting lines was three out.
 *
 * That consumer exists: `scripts/check-examples.mjs` reports a documented example's fault by LINE and
 * has no source map to consult. So the preamble ends without a newline, and each item is preceded by
 * the newlines the author wrote before it — **every line is the same line, inside a block as well as
 * outside**. Putting them all after the block instead was the first attempt and it was measured
 * wrong: every declaration collapsed onto the block's opening line, so a typo on line 186 was
 * reported on 185.
 *
 * ## Where a diagnostic lands, which depends on its kind
 *
 * Measured through a real `ts.Program`, and worth knowing before reading a position:
 *
 * | written | reported | lands on |
 * |---|---|---|
 * | `dsiplay: flex` | `TS2561`, *did you mean 'display'* | the property |
 * | `display: flexx` | `TS2820`, *did you mean "flex"* | the property |
 * | `padding: {{this.size}}` | `TS2322`, `boolean` not assignable | the property |
 * | `color: {{missing}}` | `TS2304`, cannot find name | the **expression** |
 *
 * TypeScript reports an object literal's assignability errors at the property assignment, whose start
 * is the key; an error about a name inside an expression is reported on the name. Both map home
 * correctly and neither is a fault to fix — but a caller printing a caret has to know that a value
 * error points at its declaration.
 */

export interface VirtualFileOptions {
  /** Where the block shape is imported from. Track C fills that module in; the shape is stable. */
  readonly properties?: string;
  /**
   * Read a half-written block instead of refusing it — for an editor, which sees nothing else.
   *
   * Measured: `disp` and `&:hover { col }` both refuse in strict mode, and those are the two states
   * a person is in most while typing a property name. A refusal means no virtual file, which means
   * no completions exactly when they are wanted. See `ReadOptions.tolerant`.
   */
  readonly tolerant?: boolean;
}

export interface VirtualFile {
  /** Valid TSX. */
  readonly code: string;
  /**
   * Where the generated prologue ends.
   *
   * A diagnostic before this and mapping NOWHERE is about the declaration this wrote — the helper,
   * and the type it is declared against. It is the one scaffolding a caller must not drop: if the
   * shape cannot be resolved, everything becomes `any`, nothing is checked, and a silent pass is the
   * worst answer a checker can give.
   *
   * The author's own leading comments are copied in front of the prologue, so they are before this
   * too — and they map, which is how a diagnostic about a bad `/// <reference … />` still lands on
   * the line the author wrote it. Mapping is what tells the two apart, not the offset alone.
   */
  readonly preamble: number;
  /**
   * The author offset a virtual offset came from, or `undefined` when it is scaffolding.
   *
   * A diagnostic whose start maps to `undefined` is about the file this wrote and must not be shown.
   */
  homeOf(offset: number): number | undefined;
  /**
   * Where the DECLARATION holding an author offset begins, in virtual coordinates.
   *
   * A caret inside a value or a selector maps into a string literal, and TypeScript has nothing to
   * say about a position inside one — measured, hover over `column;` and over `&:hover` both came
   * back empty. The declaration is what a reader was asking about anyway, so a question that lands
   * nowhere is asked again here.
   */
  declarationOf(offset: number): number | undefined;
  /**
   * The virtual offset for an author offset — the other direction, and the one an editor needs.
   *
   * A caret is in the author's file and every question about it has to be asked of the virtual one.
   * Measured on a plain object literal, which is what a block becomes: **inside** a half-typed key
   * gives the property names, **inside** a half-typed value gives the value union, and immediately
   * after a complete key gives nothing useful. So this lands inside the token rather than at its
   * edge, which is what makes completion work at all.
   */
  virtualOf(offset: number): number | undefined;
  /**
   * A virtual SPAN in the author's coordinates — start and length, not two lookups.
   *
   * Two lookups do not work and the failure is quiet: a span over a rewritten run ends exactly at
   * that run's edge, where the next virtual text is punctuation this file invented, so the end maps
   * nowhere and the caller is left clamping to an empty span. Measured — a `dsiplay` diagnostic
   * highlighting nothing. The run knows how much of the author's text it stands for, so this asks it.
   */
  spanOf(start: number, length: number): { start: number; length: number } | undefined;
}

/** One run of virtual text, and where it came from. */
interface Segment {
  /** Virtual offsets, half-open. */
  readonly from: number;
  readonly to: number;
  /** The author offset this run starts at. */
  readonly source: number;
  /**
   * How much of the AUTHOR's text this run stands for.
   *
   * For a copied run it is the same as the virtual length. For a rewritten one it is not — a
   * property name gains quotes, a value is folded — and the two are different questions. This is the
   * one an author-offset lookup asks: a caret past the end of the text a segment stands for belongs
   * to nothing yet, and treating it as belonging to the last segment before it is what made a caret
   * on a blank line map into the previous declaration's value. Measured: 0 completions where 551
   * were wanted.
   */
  readonly sourceLength: number;
}

/** `undefined` when the file holds no block — there is then nothing a virtual copy would add. */
export function virtualFile(source: string, options: VirtualFileOptions = {}): VirtualFile | undefined {
  if (!mayHoldABlock(source)) return undefined;
  const tolerant = options.tolerant === true;

  const sites = findBlocks(source);
  if (sites.length === 0) return undefined;

  const segments: Segment[] = [];
  /** How far the author's text has been accounted for. Set once the leading trivia is copied. */
  let cursor = 0;
  let code = "";

  /** Text this file invented. Nothing maps to it, so a diagnostic in it is dropped. */
  const write = (text: string): void => {
    code += text;
  };

  /** The author's own bytes, so an offset inside maps offset for offset. */
  const copy = (start: number, end: number): void => {
    segments.push({ from: code.length, to: code.length + (end - start), source: start, sourceLength: end - start });
    code += source.slice(start, end);
  };

  /**
   * Their text, rewritten. Every offset inside maps to where it started, and `length` is how much of
   * the author's own text it stands for — see {@link Segment.sourceLength}.
   */
  const derived = (text: string, at: number | undefined, length = text.length): void => {
    if (at !== undefined) {
      segments.push({ from: code.length, to: code.length + text.length, source: at, sourceLength: length });
    }
    code += text;
  };

  /**
   * The author's leading comments, copied BEFORE anything of ours is written.
   *
   * Two directives only work in a file's leading trivia, and putting a `declare` in front of them
   * took both away — measured: `// @ts-nocheck` was ignored, so every error in a file the author had
   * switched off came back, and `/// <reference … />` was dropped, so the types it pulls in were
   * missing and the check reported code that is fine. Both are FALSE reports, which is the one
   * failure a checker does not survive.
   *
   * Nothing moves: the `declare` goes at the start of the line the first statement was already on,
   * which is what it did at line 1 before.
   */
  const top = afterLeadingTrivia(source);
  if (top > 0) copy(0, top);
  cursor = top;

  const block = binding(source, "__block");
  const from = JSON.stringify(options.properties ?? "@ramonda/css/properties");
  /**
   * A `declare`, not an `import` statement: an import would turn a file that is a script into a
   * module, which changes what the author's own code means. An import TYPE in a type position does
   * not.
   */
  write(`declare function ${block}(declarations: import(${from}).CssBlockShape[]): import(${from}).CssBlock;`);

  /**
   * Composition's two helpers, and each is its own ARRAY ELEMENT rather than something wrapping a
   * group — which is the one thing measured about this encoding.
   *
   * Writing a group as `__when(condition, [ … ])` means a wrong condition **hides every fault in the
   * body**: the failed inference degrades the whole call, so the condition was reported and the two
   * typos under it were not. Beside the declarations rather than around them, everything comes back
   * together, each at its own position — and the group's nesting is not needed here at all, because
   * a declaration inside a group is checked exactly like one outside it.
   */
  const condition = binding(source, "__cond");
  const spread = binding(source, "__from");
  write(`declare function ${condition}<T>(condition: import(${from}).CssCondition<T>): never;`);
  write(`declare function ${spread}<T>(block: import(${from}).CssSpreadable<T>): never;`);

  /**
   * One more declaration per KIND of named site the file holds, and only the kinds it holds.
   *
   * A named site is a different vocabulary — frames, or descriptors — so it cannot go through the
   * same function, and a file with no named site should not pay for the types of one.
   *
   * **Its body is a single object literal, where an ordinary block is an array of them.** That is
   * the one place the reporting trade is worth losing: TypeScript reports one fault per literal, so
   * an array reports every fault at once — but only a whole literal can be MISSING something, and a
   * `@font-face` without `src` is the fault worth catching most. These bodies are three or four
   * lines, so the cost is bounded and the check is not available any other way.
   */
  const surfaces = new Map<string, string>();
  for (const site of sites) {
    if (site.at === undefined || surfaces.has(site.at)) continue;
    const shape = SURFACES[site.at];
    if (shape === undefined) continue;
    const name = binding(source, `__${site.at.replace(/-/g, "_")}`);
    surfaces.set(site.at, name);
    write(`declare function ${name}(body: import(${from}).${shape}): never;`);
  }

  const preamble = code.length;

  /** Each block's interior, and where a caret inside it goes when no item claims it. */
  const slots: { from: number; to: number; at: number }[] = [];
  /**
   * Each declaration's extent in the author's file, and where its KEY is in the virtual one.
   *
   * For a caret that lands somewhere TypeScript will not answer about — inside a value's string
   * literal, inside a selector — so the question can be asked of the declaration instead.
   */
  const heads: { from: number; to: number; at: number }[] = [];

  /** What a reference stands for, so the check reads the file the way the build compiles it. */
  const references = namedSites(source);

  for (const site of sites) {
    // A `name=@@(` found INSIDE a block belongs to that block's text, not to the file. The transform
    // refuses one; here it is simply passed over, because this file exists to be type-checked and a
    // refusal belongs to the build.
    if (site.start < cursor) continue;

    const read = readBlock(source, site.open, "", {
      tolerant: options.tolerant,
      resolve: (name) => references.get(name),
    });

    /**
     * How much of the author's text stands, and it is what the transform decides too: a bare JSX
     * attribute is rewritten from its NAME, because the braces are ours to add; the two expression
     * spellings keep everything to the left of the block, because there the braces are the author's
     * or would be wrong. See `BlockSite.wrap`.
     */
    /** A named site's own function and its single literal; `undefined` for an ordinary block. */
    const surface = site.at === undefined ? undefined : surfaces.get(site.at);
    /** Just inside a named site's literal — where a caret that claims nothing else belongs. */
    let inside = 0;

    if (surface !== undefined) {
      copy(cursor, site.start);
      write(`${surface}(`);
      /**
       * The literal's own brace stands for the block's OPENING, and it has to stand for something.
       *
       * A required descriptor that is missing is reported on the whole literal, not on any line
       * inside it — so if the brace maps nowhere the diagnostic has no home and is dropped, which is
       * what happened: a `@font-face` with no `src` passed in silence. It maps to `@@font-face(`,
       * which is where an author would look for a fault about the block as a whole.
       */
      derived("{", site.start, site.open + 1 - site.start);
      inside = code.length;
    } else if (site.wrap) {
      copy(cursor, site.start);
      copy(site.start, site.start + site.name.length);
      write(`={${block}([`);
    } else {
      copy(cursor, site.start);
      write(`${block}([`);
    }
    /** How far the author's text has been accounted for, in LINES. See `keepLine`. */
    let lined = site.open;
    /**
     * The newlines the author wrote above something, put back before it is emitted.
     *
     * The default handles a block built by hand, which has no positions: nothing here produces one,
     * but the type allows it. `countNewlines` counts nothing for a span that runs backwards, so the
     * mark only ever moves forward.
     */
    const keepLine = (upTo = lined): void => {
      write("\n".repeat(countNewlines(source, lined, upTo)));
      lined = Math.max(lined, upTo);
    };
    items(read.block.items, read.holes, keepLine, surface !== undefined);

    /**
     * An empty object literal at the end of the block, **for an editor only**.
     *
     * Measured, and it is the state you are in first: with nothing typed yet, a caret in the block
     * belonged to no segment at all and got zero completions — as did a caret on a blank line after
     * a declaration, and one after a semicolon. Three of the four "nothing typed" positions.
     *
     * An empty literal is somewhere for that caret to be, and TypeScript offers every property name
     * inside one. `slots` records the block's interior so the reverse lookup can send anything the
     * items do not claim here.
     */
    if (tolerant) {
      /**
       * Somewhere for a caret that no run of text claims — see the note below on the empty literal.
       *
       * A named site gets no literal of its own to sit in: it IS one already, and a second `{}`
       * inside an object is a syntax error rather than a place. So its slot points just inside its
       * own brace. Measured before that was written: the slot pointed past the last declaration,
       * which lands in the `})` that closes the call, and **every caret in a named block got zero
       * completions** — thirteen descriptors offered as nothing at all.
       */
      slots.push({ from: site.open, to: read.end, at: surface === undefined ? code.length + 1 : inside });
      if (surface === undefined) write("{},");
    }

    write(surface !== undefined ? "})" : site.wrap ? "])}" : "])");

    // Whatever the block spanned below its last item — the closing `)` on a line of its own.
    keepLine(read.end + 1);

    cursor = read.end + 1;
  }
  copy(cursor, source.length);

  /** By author offset, for the reverse lookup. The forward list is already in virtual order. */
  const bySource = [...segments].sort((a, b) => a.source - b.source);

  return {
    code,
    preamble,
    homeOf: (offset) => homeOf(segments, offset),
    spanOf: (start, length) => spanOf(segments, start, length),
    virtualOf: (offset) => virtualOf(bySource, offset) ?? slotFor(slots, offset),
    declarationOf: (offset) => declarationOf(heads, offset),
  };

  /**
   * One object literal PER DECLARATION, gathered in an array.
   *
   * Measured: TypeScript reports one failure per object literal and stops, so a block written as a
   * single literal with three faults in it reports one — and the author fixes it, re-runs, and meets
   * the next. An array of one-declaration literals reports all three at once, each with its own
   * position and its own suggestion, nested rules included.
   */
  function items(
    list: readonly BlockItem[],
    holes: readonly Span[],
    keepLine: (upTo?: number) => void,
    single = false,
  ): void {
    for (const item of list) {
      // The newlines the author wrote above this declaration, so it lands on its own line.
      keepLine(item.at);

      /**
       * Composition is checked BESIDE the declarations, not around them.
       *
       * A group's condition and a spread's operand are each their own array element — `never` is
       * assignable to a declaration, so a helper call sits among them — and each is written before
       * the object literal a declaration would open, because neither is one.
       *
       * **Measured, and it is why the encoding is this and not the obvious one:** writing a group as
       * `__when(condition, [ … ])` meant a wrong condition HID every fault under it, because the
       * failed inference degrades the whole call. Beside rather than around, everything comes back
       * at once. The grouping itself is written down nowhere, because nothing about it is a type
       * question — a declaration inside a group is checked exactly like one outside it.
       */
      const guard = item.kind === "rule" ? holeIn(item.prelude, CONDITION) : undefined;
      if (guard !== undefined && item.kind === "rule") {
        write(`${condition}(`);
        expression(holes[guard]);
        write(single ? ")," : "),");
        items(item.items, holes, keepLine, single);
        continue;
      }

      const spreading = item.kind === "declaration" ? holeIn(item.property, SPREAD) : undefined;
      if (spreading !== undefined && item.kind === "declaration") {
        write(`${spread}(`);
        expression(holes[spreading]);
        write("),");
        keepLine(item.end);
        continue;
      }

      if (!single) write("{");
      if (item.kind === "rule") {
        if (item.at !== undefined) {
          heads.push({ from: item.at, to: item.preludeEnd ?? item.at, at: code.length + 1 });
        }
        derived(quoted(item.prelude), item.at, (item.preludeEnd ?? item.at ?? 0) - (item.at ?? 0));
        write(":[");
        items(item.items, holes, keepLine);
        write("]");
      } else {
        if (item.at !== undefined) heads.push({ from: item.at, to: item.end ?? item.at, at: code.length + 1 });
        derived(key(propertyName(item.property)), item.at, item.property.length);
        write(":");
        value(item.value, item.valueAt, item.end, holes);
        keepLine(item.end);
      }
      write(single ? "," : "},");
    }
  }

  /**
   * A declaration's value, in the form that carries the most type information.
   *
   * Three shapes, and the choice is what decides which diagnostic the author gets:
   *
   * - **the whole value is one hole** — the expression itself, so it is checked against the
   *   property's own type and `padding: {{nekaFunc()}}` is a `TS2322` about `padding`;
   * - **no holes at all** — a string literal, so a union-typed property gives `TS2820` with *did you
   *   mean*, which a template literal would not;
   * - **text and holes together** — a template literal, so `padding: {{n}}px` is checked against
   *   `` `${number}px` `` rather than collapsing to `string`.
   */
  function value(
    parts: readonly ValuePart[],
    at: number | undefined,
    end: number | undefined,
    holes: readonly Span[],
  ): void {
    const length = at === undefined || end === undefined ? undefined : end - at;
    if (parts.length === 1 && parts[0].kind === "hole") {
      expression(holes[parts[0].index]);
      return;
    }

    if (!parts.some((part) => part.kind === "hole")) {
      derived(quoted(collapse(parts.map((part) => (part.kind === "text" ? part.text : "")).join(""))), at, length);
      return;
    }

    write("`");
    for (const part of parts) {
      if (part.kind === "text") {
        derived(inTemplate(collapse(part.text)), at, length);
        continue;
      }
      write("${");
      expression(holes[part.index]);
      write("}");
    }
    write("`");
  }

  /**
   * One hole's expression, byte for byte where the author wrote it.
   *
   * Parenthesised, so a comma or a low-precedence operator inside cannot change what the surrounding
   * syntax means — and the parens are written rather than copied, so nothing maps to them.
   */
  function expression(span: Span): void {
    write("(");
    copy(span.start, span.end);
    write(")");
  }
}

/**
 * Where the author's leading comments end, which is where a `declare` of ours may first go.
 *
 * Only whitespace and comments are skipped — the first thing that is neither is where the file's
 * own code begins, and a directive that has to be above it stays above it. A file that is nothing
 * but comments has no code to put anything in front of, so the whole file is trivia and the answer
 * is its length.
 */
function afterLeadingTrivia(source: string): number {
  let at = 0;
  while (at < source.length) {
    const code = source.charCodeAt(at);
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 12) {
      at++;
      continue;
    }
    if (code === 47 /* / */ && source.charCodeAt(at + 1) === 47) {
      const end = source.indexOf("\n", at + 2);
      at = end === -1 ? source.length : end + 1;
      continue;
    }
    if (code === 47 && source.charCodeAt(at + 1) === 42 /* * */) {
      const end = source.indexOf("*/", at + 2);
      at = end === -1 ? source.length : end + 2;
      continue;
    }
    return at;
  }
  return at;
}

/**
 * Which type a named site's body is checked against.
 *
 * Written here rather than derived, because there is nothing to derive it from: `@keyframes` holds
 * frames, and the other two hold descriptors that only their own at-rule accepts. A site whose name
 * is not in this table gets no surface and no check — the transform refuses it separately, and the
 * order between the two is not something this can rely on.
 */
const SURFACES: Readonly<Record<string, string>> = {
  keyframes: "CssKeyframesShape",
  "font-face": "CssFontFaceDescriptors",
  property: "CssPropertyDescriptors",
};

/** How many newlines the author wrote between two offsets. */
function countNewlines(source: string, from: number, to: number): number {
  let lines = 0;
  for (let index = from; index < to; index++) {
    if (source.charCodeAt(index) === 10) lines++;
  }
  return lines;
}

/**
 * The virtual offset an author offset became.
 *
 * A copied run maps offset for offset. A REWRITTEN one — a quoted key, a folded value — has no such
 * correspondence, so the caret is placed proportionally inside the emitted text and clamped to stay
 * inside it. Measured on a plain object literal: what matters is being inside the token, not being at
 * an exact character, because that is what decides whether TypeScript offers the keys.
 */
function virtualOf(bySource: readonly Segment[], offset: number): number | undefined {
  let low = 0;
  let high = bySource.length - 1;
  let found: Segment | undefined;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = bySource[middle];
    if (offset < segment.source) high = middle - 1;
    else {
      found = segment;
      low = middle + 1;
    }
  }

  // Past the text this segment stands for, so it belongs to nothing yet — a blank line, a caret
  // after a semicolon. The caller sends those to the block's empty slot.
  if (found === undefined || offset > found.source + found.sourceLength) return undefined;

  const length = found.to - found.from;
  const delta = offset - found.source;

  // A copied run: the same characters, so the same distance.
  if (length === found.sourceLength) return found.from + delta;

  // A rewritten one: inside the emitted token, never at its far edge. Measured — `{display|:` offers
  // nothing and `{displa|y` offers every property name, so being inside is what matters.
  return found.from + Math.min(Math.max(delta, 1), Math.max(length - 1, 1));
}

/**
 * The author's span for a virtual one.
 *
 * A copied run maps both ends. A rewritten one has no interior correspondence, so the whole of the
 * author's text it stands for is the answer — which is the right highlight anyway: a *did you mean*
 * about `dsiplay` underlines `dsiplay`, whatever quoting the virtual file needed.
 */
function spanOf(
  segments: readonly Segment[],
  start: number,
  length: number,
): { start: number; length: number } | undefined {
  const segment = containing(segments, start);
  if (segment === undefined) return undefined;

  const from = segment.source + (start - segment.from);

  if (segment.to - segment.from === segment.sourceLength) {
    // Copied: both ends are real. A span running past this run is clamped to it rather than guessed
    // at — a highlight that is too short is readable, one that covers invented text is not.
    return { start: from, length: Math.min(length, segment.source + segment.sourceLength - from) };
  }

  return { start: segment.source, length: segment.sourceLength };
}

/** The run an offset falls in. */
function containing(segments: readonly Segment[], offset: number): Segment | undefined {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = segments[middle];
    if (offset < segment.from) high = middle - 1;
    else if (offset >= segment.to) low = middle + 1;
    else return segment;
  }
  return undefined;
}

/**
 * The key of whichever declaration the offset falls in.
 *
 * Innermost first — a declaration inside a nested rule is inside that rule's extent too, and the
 * narrower answer is the one a reader meant.
 */
function declarationOf(heads: readonly { from: number; to: number; at: number }[], offset: number): number | undefined {
  let best: { from: number; to: number; at: number } | undefined;

  for (const head of heads) {
    if (offset < head.from || offset > head.to) continue;
    if (best === undefined || head.to - head.from < best.to - best.from) best = head;
  }

  return best?.at;
}

/** The empty slot of whichever block the offset is inside, for a caret that has typed nothing. */
function slotFor(slots: readonly { from: number; to: number; at: number }[], offset: number): number | undefined {
  for (const slot of slots) {
    if (offset > slot.from && offset <= slot.to) return slot.at;
  }
  return undefined;
}

/** The last segment starting at or before `offset`, or nothing when the offset is scaffolding. */
function homeOf(segments: readonly Segment[], offset: number): number | undefined {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = segments[middle];
    if (offset < segment.from) high = middle - 1;
    else if (offset >= segment.to) low = middle + 1;
    // A copied run maps offset for offset; a rewritten one maps to where it started, which is the
    // position a reader needs anyway — a *did you mean* about `dsiplay` belongs on `dsiplay`.
    else
      return segment.to - segment.from === segment.sourceLength
        ? segment.source + (offset - segment.from)
        : segment.source;
  }
  return undefined;
}

/**
 * `COLOR` and `color` are one property to CSS, so they are one key here too.
 *
 * Without the fold, valid CSS would be reported as a property that does not exist — a *did you mean*
 * about the author's own capitals. A custom property keeps its case, because CSS keeps it.
 */
function propertyName(property: string): string {
  return property.startsWith("--") ? property : property.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function quoted(text: string): string {
  return JSON.stringify(text);
}

/**
 * A property name as an object key — **unquoted whenever it can be**, and that is not cosmetic.
 *
 * Measured, the same typo against the same type:
 *
 *     { dsiplay: "flex" }     TS2561 … Did you mean to write 'display'?
 *     { "dsiplay": "flex" }   TS2353 … and '"dsiplay"' does not exist in type
 *
 * **A quoted key gets no suggestion.** TypeScript's own *did you mean* is the headline of the whole
 * type-safety claim, and it turns out to hang on whether the emitted key needed quotes. So a name
 * that is a valid identifier is written bare.
 *
 * A dashed name — `flex-direction`, `border-left` — cannot be, so those still get the plain message.
 * That is a limit, not a workaround: the alternative is camelCase keys, which would suggest
 * `flexDirection` to somebody writing CSS, and the fix would then have to be a rewritten compiler
 * message. Naming the near miss for a dashed property belongs to the CSS checker, where the message
 * is one we write.
 */
function key(property: string): string {
  return IDENTIFIER.test(property) ? property : quoted(property);
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Text going inside a template literal: the two things that would end it, and the escape itself. */
function inTemplate(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function binding(source: string, base: string): string {
  let name = base;
  while (source.includes(name)) name = `_${name}`;
  return name;
}
