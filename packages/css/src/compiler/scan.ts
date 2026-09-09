/**
 * Finding the blocks in a file, which is the step every other cost is measured against.
 *
 * ## Two passes, and the first one has to be free
 *
 * A codebase that uses none of this must pay nothing, so the first question is a substring search
 * for `@@` and the answer is usually no. Measured on this repository before any of it existed:
 * 1,268 files and 10.61 MB in **1.33 ms**. Only a file that survives that gets read properly.
 *
 * ## Why the opening is `@@(` and not `@(`
 *
 * `@(expr)` is *already* valid TypeScript in two places, and both were measured: on a class member,
 * `class C { @(dec) m() {} }`, and on a parameter, `constructor(@(inject()) private x: number)`. In a
 * decorator-heavy framework that is not a footnote — it forced the opening to be recognised only
 * after `name =`, which in turn kept a block out of every ordinary expression position: an argument,
 * an object value, an array item, a ternary.
 *
 * **`@@(` is a syntax error everywhere in TypeScript**, measured in all five positions — after `=`,
 * on a class member, on a parameter, as a call argument, as an object value. So the rule disappears
 * and a block goes where any other value goes.
 *
 * It also sharpens the cheap pass, the half that runs on every file of every build — but that is
 * the smaller half, and an earlier note here overstated it. Measured on this repository at the
 * commit before this parser landed, the substring `@(` matched **2 of 1,093** tracked source files,
 * and both were regular expressions rather than decorators: an ordinary decorator reads `@name(`,
 * which does not contain `@(` at all. Only the parenthesised form does — `@(dec)` — and there were
 * none. So the second `@` buys a grammar that cannot collide, not a build that skips more files.
 *
 * The substring is `@@` rather than `@@(` because a named site — `@@keyframes( … )` — does not
 * contain the second. Nothing else in TypeScript contains either.
 *
 * ## Why the second pass is still lexical
 *
 * A string, a template or a comment can contain anything, including this syntax — a file that
 * documents it does. Those are skipped by the walk rather than reasoned about, which is also what
 * makes it fast: measured at ~450 MB/s, about a fifth of the whole transform.
 */

/** One block's opening: where the name starts, where its `(` is, and how the value has to be written. */
export interface BlockSite {
  /** Offset of the first character of the name — the start of the text to replace. */
  readonly start: number;
  /** The name, as written: `css`, `sx`, or the constant an expression is being assigned to. */
  readonly name: string;
  /** Offset of the `(` that opens the block. */
  readonly open: number;
  /**
   * Offset of the first `@` — where the OPENING starts, name and all.
   *
   * Recorded rather than derived, because its width is not fixed: `@@(` is three characters and
   * `@@keyframes(` is twelve. A caller that measured back from `open` by a constant landed in the
   * middle of the at-rule's name, and the formatter handed a truncated block to be re-laid-out —
   * measured, and it is why this exists.
   *
   * The same as {@link start} for an expression site, and different for a JSX attribute, where the
   * site starts at the attribute's name.
   */
  readonly opening: number;
  /**
   * Whether the compiled value has to be wrapped in `{ }` where it is written back.
   *
   * A JSX attribute written without them needs them — `css=@@( … )` becomes `css={_s0}`. The two
   * expression spellings do not: in `css={@@( … )}` the braces are the author's, and in
   * `const panel = @@( … )` they would turn a value into an object literal.
   */
  readonly wrap: boolean;
  /**
   * The at-rule this site declares, when it declares one — `keyframes`, `font-face`, `property`.
   *
   * `undefined` for an ordinary style block, which is one element's rule and names nothing. A named
   * site produces a rule for the whole stylesheet and a value the blocks reference, so almost
   * everything downstream asks this before it asks anything else.
   */
  readonly at?: string;
}

/** The cheap question, asked before anything is read. */
export function mayHoldABlock(source: string): boolean {
  return source.includes("@@");
}

/** The words a block can be assigned after, none of which can name a JSX attribute or a tag. */
const DECLARES = new Set(["const", "let", "var", "return", "yield", "await", "default", "of", "in"]);

/** A span the forward walk stepped over — a comment, a string, a template, a regex. */
interface Quiet {
  readonly from: number;
  readonly to: number;
}

export function findBlocks(source: string): BlockSite[] {
  const found: BlockSite[] = [];
  const length = source.length;
  // A shebang is not JavaScript and is not a comment either — nothing in the language skips it, so
  // `@@(` written in one would be read as a block on a line the engine never parses.
  let index = afterShebang(source);
  /** The last character that was not whitespace, so a `/` can be told from a division. */
  let previous = 0;
  /**
   * Every span this walk STEPPED OVER — a comment, a string, a template, a regex.
   *
   * Recorded because `isAttribute` walks BACKWARDS and cannot answer the same question: it sees raw
   * text, so a `<` inside a line comment above an assignment made it read the assignment as a JSX
   * attribute. Measured, and it is the direction that function says must never happen —
   * `const panel = @@( … )` under `// the <div wrapper` compiled to `const panel = {_s0};`, an
   * object literal rather than the merged style, with nothing reported.
   *
   * The forward walk already knows, and by the time a site is reached everything behind it has been
   * scanned. So the backwards walk asks rather than guessing.
   */
  const quiet: { from: number; to: number }[] = [];

  while (index < length) {
    const code = source.charCodeAt(index);

    if (code === 47 /* / */) {
      const next = source.charCodeAt(index + 1);
      if (next === 47) {
        const end = source.indexOf("\n", index);
        if (end === -1) break;
        quiet.push({ from: index, to: end + 1 });
        index = end + 1;
        previous = 10;
        continue;
      }
      if (next === 42) {
        const end = source.indexOf("*/", index + 2);
        if (end === -1) break;
        quiet.push({ from: index, to: end + 2 });
        index = end + 2;
        continue;
      }
      /**
       * A regular expression, whose body can contain anything — including this syntax.
       *
       * It used to be settled for free: the opening had to be preceded by `name =`, and a `=` inside
       * `/=@@(x)/` is preceded by `/`. A block is an ordinary value now, so nothing about its
       * surroundings rules it out and the walk has to know a regex when it sees one.
       *
       * Which is the same question every JavaScript lexer answers the same way: a `/` is a division
       * when something that can END an expression is behind it, and a regex otherwise.
       */
      if (startsARegex(previous)) {
        const end = endOfRegex(source, index);
        quiet.push({ from: index, to: end });
        index = end;
        previous = 47;
        continue;
      }
      index++;
      previous = 47;
      continue;
    }

    if (code === 34 /* " */ || code === 39 /* ' */) {
      const end = endOfQuoted(source, index);
      quiet.push({ from: index, to: end });
      index = end;
      previous = code;
      continue;
    }

    if (code === 96 /* ` */) {
      const end = endOfTemplate(source, index);
      quiet.push({ from: index, to: end });
      index = end;
      previous = 96;
      continue;
    }

    if (code === 64 /* @ */ && source.charCodeAt(index + 1) === 64) {
      /**
       * `@@(` is a style block, and `@@keyframes(` and its two siblings name something the whole
       * stylesheet uses. One opening with an optional name rather than three spellings, because the
       * walk that has to be free should look for one thing.
       */
      let after = index + 2;
      while (after < length && isNameCharacter(source.charCodeAt(after))) after++;

      if (source.charCodeAt(after) === 40 /* ( */) {
        const site = siteBefore(source, index, quiet);
        if (site !== undefined) {
          const named = source.slice(index + 2, after);
          found.push({ ...site, open: after, opening: index, at: named === "" ? undefined : named.toLowerCase() });
          // The block's own text is read by the parser, which is the only thing that can tell where
          // it ends — a `)` inside a string or an expression does not close it. Resuming right after
          // the `(` is safe because a nested block is not a thing: the walk finds the same opening
          // again only if the parser left it, and the parser consumes the whole block.
          index = after + 1;
          continue;
        }
      }
    }

    if (!isSpace(code)) previous = code;
    index++;
  }

  return found;
}

/**
 * Whether a `/` here opens a regular expression rather than dividing.
 *
 * The classic lexer question, answered the classic way: a `/` divides only when something that can
 * END an expression is behind it — a name, a number, a closing bracket. Everything else is a regex.
 * Erring towards "regex" is the safe direction here: the cost is skipping text that was a division,
 * and a division cannot contain a block anyway.
 */
function startsARegex(previous: number): boolean {
  if (previous === 0) return true;
  const ends =
    isNameCharacter(previous) ||
    previous === 41 /* ) */ ||
    previous === 93 /* ] */ ||
    previous === 34 ||
    previous === 39;
  return !ends;
}

/** Past the closing `/` of a regex, character classes included, or the end of the source. */
function endOfRegex(source: string, start: number): number {
  let inClass = false;
  for (let index = start + 1; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (code === 92 /* \\ */) index++;
    else if (code === 91 /* [ */) inClass = true;
    else if (code === 93 /* ] */) inClass = false;
    else if (code === 47 /* / */ && !inClass) return index + 1;
    else if (code === 10) return index;
  }
  return source.length;
}

/**
 * Past a SHEBANG, which is where every reader of this file has to start.
 *
 * `#!` is not JavaScript and is not a comment — nothing in the language skips it — and it is legal
 * only at offset 0. Three places needed the same answer and two of them had it: `findBlocks`, so a
 * `@@(` written in one is not read as a block, and `transform`'s `afterDirectives`. The virtual file
 * did not, so a `declare` of ours went in FRONT of it and the whole file stopped parsing — with
 * nothing in it checked, because a file that does not parse has no semantics to ask about.
 */
export function afterShebang(source: string): number {
  return source.startsWith("#!") ? nextLine(source, 0) : 0;
}

/** The start of the line after the one `from` is on, or the end of the source. */
function nextLine(source: string, from: number): number {
  const line = source.indexOf("\n", from);
  return line === -1 ? source.length : line + 1;
}

/** Past the closing quote of a string starting at `start`, or the end of the source. */
function endOfQuoted(source: string, start: number): number {
  const quote = source.charCodeAt(start);
  let index = start + 1;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 92 /* \ */) {
      index += 2;
      continue;
    }
    if (code === quote) return index + 1;
    // A newline ends an unterminated string rather than running to the end of the file: the walk is
    // looking for attributes, and treating the rest of a module as one string would hide them all.
    if (code === 10) return index + 1;
    index++;
  }
  return index;
}

/**
 * Past the closing backtick, following `${ … }` into real code and back out.
 *
 * A template's substitutions are code, and code can contain another template — so this recurses
 * rather than looking for the next backtick, which would stop inside a nested one.
 */
function endOfTemplate(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 92 /* \ */) {
      index += 2;
      continue;
    }
    if (code === 96 /* ` */) return index + 1;
    if (code === 36 /* $ */ && source.charCodeAt(index + 1) === 123 /* { */) {
      index = endOfSubstitution(source, index + 2);
      continue;
    }
    index++;
  }
  return index;
}

/** Past the `}` closing a `${`, counting braces and skipping the strings between them. */
function endOfSubstitution(source: string, start: number): number {
  let index = start;
  let depth = 1;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 34 || code === 39) {
      index = endOfQuoted(source, index);
      continue;
    }
    if (code === 96) {
      index = endOfTemplate(source, index);
      continue;
    }
    if (code === 123 /* { */) depth++;
    else if (code === 125 /* } */) {
      depth--;
      if (depth === 0) return index + 1;
    }
    index++;
  }
  return index;
}

/**
 * Whether an `@(` at `at` is the value of a JSX attribute, and which one.
 *
 * Walks back over whitespace, an `=`, more whitespace and a name, and requires whitespace before
 * the name — which is what separates one attribute from the tag or from the attribute before it.
 * Everything the walk cannot reach this way is left alone.
 */
function siteBefore(
  source: string,
  at: number,
  quiet: readonly Quiet[],
): { start: number; name: string; wrap: boolean } | undefined {
  let index = at - 1;
  while (index >= 0 && isSpace(source.charCodeAt(index))) index--;

  /**
   * `css={@@( … )}` — a block written as an EXPRESSION, inside the braces JSX already has for one.
   *
   * It exists because of a limit nothing here can lift: an editor stops consulting syntax injections
   * the moment it enters a tag's attribute list, so an unbraced block gets no colours unless it is
   * the first attribute on the tag name's own line. Inside braces it is ordinary expression
   * position, and every editor question works there.
   */
  const braced = index >= 0 && source.charCodeAt(index) === 123; /* { */
  if (braced) {
    index--;
    while (index >= 0 && isSpace(source.charCodeAt(index))) index--;
  }

  /**
   * A block is an ordinary value, so it goes where any other value goes — an argument, an item, a
   * branch of a ternary. There is nothing to require in front of it, because `@@(` means nothing
   * else in TypeScript.
   *
   * What is read here is only what the WRITER needs: the name of a bare JSX attribute, so the value
   * can be given the braces the author did not write. Everything else is replaced where it stands.
   */
  if (index < 0 || source.charCodeAt(index) !== 61 /* = */) return { start: at, name: "", wrap: false };

  index--;
  while (index >= 0 && isSpace(source.charCodeAt(index))) index--;

  const end = index + 1;
  while (index >= 0 && isNameCharacter(source.charCodeAt(index))) index--;
  const start = index + 1;

  // `x.css=@@(` is a member assignment, not an attribute, and `=@@(` with no name is `a >= @@(`.
  if (start === end || (index >= 0 && !isSpace(source.charCodeAt(index)))) {
    return { start: at, name: "", wrap: false };
  }

  /**
   * `start` is what the writer replaces FROM, and the two forms differ: a bare JSX attribute is
   * rewritten from its name, because the braces are ours to add, and everything else from the block
   * itself, because to its left is the author's own text.
   */
  const name = source.slice(start, end);
  const wrap = !braced && isAttribute(source, start, quiet);
  return { start: wrap ? start : at, name, wrap };
}

/**
 * Whether the name at `start` is a JSX ATTRIBUTE rather than something being assigned to.
 *
 * `css=@@( … )` and `const panel = @@( … )` are the same three tokens to the walk above — whitespace,
 * a name, `=` — and they must not compile to the same thing: an attribute takes braces around the
 * value and an assignment must not have them. Nothing shorter than reading backwards can separate
 * them, so this consumes attributes backwards until it reaches the `<` that opens a tag.
 *
 * **It answers NO when it cannot prove otherwise, and the direction is the point.** An attribute
 * mistaken for an assignment emits `css=_s0`, which is a syntax error the build reports at once. The
 * other way round emits an object literal, which is valid code that means the wrong thing.
 */
function isAttribute(source: string, start: number, quiet: readonly Quiet[]): boolean {
  let index = start - 1;

  for (;;) {
    while (index >= 0 && isSpace(source.charCodeAt(index))) index--;
    if (index < 0) return false;

    /**
     * Anything the FORWARD walk stepped over is stepped over here too.
     *
     * This walk sees raw text, so it read the characters inside a comment as code: a `<` in a line
     * comment above an assignment made it reach a tag opening that is not there, and answer YES —
     * measured, `const panel = @@( … )` under `// the <div wrapper` compiled to
     * `const panel = {_s0};`, an object literal rather than the merged style, with nothing reported.
     * That is the direction this function's own note says must never happen.
     *
     * A block comment and a string never leaked, for reasons that were accidents rather than rules:
     * `*\/` ends the backwards scan on a character it does not know, and a quote is stepped over by
     * the branch below. Now all four are one answer, from the walk that computed it going forward.
     */
    const stepped = quiet.find((one) => index >= one.from && index < one.to);
    if (stepped !== undefined) {
      index = stepped.from - 1;
      continue;
    }

    const code = source.charCodeAt(index);

    // The `=` of an attribute written before this one, whose value has just been stepped over.
    if (code === 61 /* = */) {
      index--;
      continue;
    }

    /**
     * A braced value written before this one: `name={…}`, or `{...spread}`.
     *
     * Stepping over it needs no `return`: an opener that is not there leaves the walk before the
     * start of the file, which the top of the loop already answers.
     *
     * A QUOTED one is not handled here any more — it is a span the forward walk stepped over, so the
     * check above has already jumped past it. Two answers for one question was how a brace inside a
     * string came to be counted as structure.
     */
    if (code === 125 /* } */) {
      index = beforeOpening(source, index, quiet);
      continue;
    }

    /**
     * A BARE BLOCK written as the attribute before this one — `css=@@( … ) sx=@@( … )`.
     *
     * Nothing stepped over it, so the walk met the `)` and gave up: the SECOND bare block on a tag
     * was read as an assignment. Measured, and it breaks two things at once — the build emitted
     * `sx=_s1`, a JSX attribute holding a bare identifier, and the formatter was handed
     * `sx=/*…*\/ 0`, which biome cannot parse either. One scan fault, two victims.
     *
     * Counted backwards, which cannot be exact: a `)` inside a string in the block's own CSS would
     * throw the depth off. That is safe HERE and only here, because a walk that fails to prove an
     * attribute answers NO — which is what it already did for this shape, so a wrong count costs
     * nothing that is not already lost. See this function's own note on the direction.
     */
    if (code === 41 /* ) */) {
      const opening = beforeBlockOpening(source, index);
      if (opening === undefined) return false;
      index = opening;
      continue;
    }

    if (!isNameCharacter(code) && code !== 46 /* . */) return false;

    /**
     * A name: the tag's own, which ends the search, or an attribute written before this one —
     * a bare `disabled`, or the name belonging to a value already stepped over.
     */
    const from = index;
    while (index >= 0 && (isNameCharacter(source.charCodeAt(index)) || source.charCodeAt(index) === 46)) index--;

    /**
     * A DECLARATION KEYWORD is neither, so the walk stops rather than reading past it.
     *
     * `const small = a<b` on the line above left a `<` for the walk to reach, and it reached it
     * through the word `const` — read as an attribute written before this one. Measured:
     * `const panel = @@( … )` came out `const panel = {_s0};`, an object literal rather than the
     * merged style. A keyword cannot be an attribute's name and cannot be a tag's, so meeting one
     * settles the question in the direction this function answers when it cannot prove otherwise.
     */
    if (DECLARES.has(source.slice(index + 1, from + 1))) return false;

    if (index >= 0 && source.charCodeAt(index) === 60 /* < */) return true;
  }
}

/**
 * The offset just before the `@@` that opened the block whose `)` is at `at`, or nothing.
 *
 * The parens are counted rather than parsed, and the walk gives up unless it lands on a real
 * opening: `@@(`, or `@@` and a name and `(`. Anything else leaves the caller answering NO, which
 * is the direction it answers when it cannot prove an attribute.
 */
function beforeBlockOpening(source: string, at: number): number | undefined {
  let depth = 0;
  for (let index = at; index >= 0; index--) {
    const code = source.charCodeAt(index);
    if (code === 41) depth++;
    else if (code === 40) {
      depth--;
      if (depth > 0) continue;

      let name = index - 1;
      while (name >= 0 && isNameCharacter(source.charCodeAt(name))) name--;
      if (name >= 1 && source.charCodeAt(name) === 64 && source.charCodeAt(name - 1) === 64) return name - 2;
      return undefined;
    }
  }
  return undefined;
}

/**
 * The offset just before the `{` that opened the value ending at `at`, or -1 when nothing did.
 *
 * Braces are COUNTED, because an attribute's expression holds its own. It used to answer for quotes
 * too; a quoted value is a span the forward walk steps over, so the caller never reaches this with
 * one and that half was dead.
 */
function beforeOpening(source: string, at: number, quiet: readonly Quiet[]): number {
  {
    let depth = 0;
    for (let index = at; index >= 0; index--) {
      /**
       * A brace inside a STRING, a comment or a regex is text, and this counted it.
       *
       * Measured, four shapes that made a real attribute read as an assignment and emit `css=_s0`, a
       * JSX attribute holding a bare identifier: `title={"}"}`, `title={t("a } b")}`,
       * `onclick={() => { f("{") }}`, `onclick={() => s.replace(/}/g, "")}`. The safe direction — the
       * build stops at once — but the message names neither the brace nor the string it is in.
       *
       * The forward walk knows which spans are text; see {@link findBlocks}.
       */
      const stepped = quiet.find((one) => index >= one.from && index < one.to);
      if (stepped !== undefined) {
        index = stepped.from;
        continue;
      }

      const here = source.charCodeAt(index);
      if (here === 125 /* } */) depth++;
      else if (here === 123 /* { */ && --depth === 0) return index - 1;
    }
  }

  return -1;
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

/** A JSX attribute name: letters, digits, `_`, `$`, and the `-` and `:` that namespaced ones carry. */
function isNameCharacter(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 95 ||
    code === 36 ||
    code === 45 ||
    code === 58
  );
}
