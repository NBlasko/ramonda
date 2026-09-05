/**
 * Finding the blocks in a file, which is the step every other cost is measured against.
 *
 * ## Two passes, and the first one has to be free
 *
 * A codebase that uses none of this must pay nothing, so the first question is a substring search
 * for `@@(` and the answer is usually no. Measured on this repository before any of it existed:
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
 * It also makes the cheap pass sharper, which is the half that runs on every file of every build:
 * measured on this repository, the substring `@(` matches **41** files and only **2** hold a block —
 * the other 39 are decorators, each paying a full lexical walk for nothing. `@@(` matches the 2.
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
   * Whether the compiled value has to be wrapped in `{ }` where it is written back.
   *
   * A JSX attribute written without them needs them — `css=@@( … )` becomes `css={_s0}`. The two
   * expression spellings do not: in `css={@@( … )}` the braces are the author's, and in
   * `const panel = @@( … )` they would turn a value into an object literal.
   */
  readonly wrap: boolean;
}

/** The cheap question, asked before anything is read. */
export function mayHoldABlock(source: string): boolean {
  return source.includes("@@(");
}

export function findBlocks(source: string): BlockSite[] {
  const found: BlockSite[] = [];
  const length = source.length;
  // A shebang is not JavaScript and is not a comment either — nothing in the language skips it, so
  // `@@(` written in one would be read as a block on a line the engine never parses.
  let index = source.startsWith("#!") ? nextLine(source, 0) : 0;
  /** The last character that was not whitespace, so a `/` can be told from a `/`. */
  let previous = 0;

  while (index < length) {
    const code = source.charCodeAt(index);

    if (code === 47 /* / */) {
      const next = source.charCodeAt(index + 1);
      if (next === 47) {
        const end = source.indexOf("\n", index);
        if (end === -1) break;
        index = end + 1;
        previous = 10;
        continue;
      }
      if (next === 42) {
        const end = source.indexOf("*/", index + 2);
        if (end === -1) break;
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
        index = endOfRegex(source, index);
        previous = 47;
        continue;
      }
      index++;
      previous = 47;
      continue;
    }

    if (code === 34 /* " */ || code === 39 /* ' */) {
      index = endOfQuoted(source, index);
      continue;
    }

    if (code === 96 /* ` */) {
      index = endOfTemplate(source, index);
      continue;
    }

    if (code === 64 /* @ */ && source.charCodeAt(index + 1) === 64 && source.charCodeAt(index + 2) === 40 /* ( */) {
      const site = siteBefore(source, index);
      if (site !== undefined) {
        found.push({ ...site, open: index + 2 });
        // The block's own text is read by the parser, which is the only thing that can tell where it
        // ends — a `)` inside a string or an expression does not close it. Resuming right after the
        // `(` is safe because a nested block is not a thing: the walk finds the same opening again
        // only if the parser left it, and the parser consumes the whole block.
        index += 3;
        continue;
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
function siteBefore(source: string, at: number): { start: number; name: string; wrap: boolean } | undefined {
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
  const wrap = !braced && isAttribute(source, start);
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
function isAttribute(source: string, start: number): boolean {
  let index = start - 1;

  for (;;) {
    while (index >= 0 && isSpace(source.charCodeAt(index))) index--;
    if (index < 0) return false;

    const code = source.charCodeAt(index);

    // The `=` of an attribute written before this one, whose value has just been stepped over.
    if (code === 61 /* = */) {
      index--;
      continue;
    }

    // A value written before this one: `name={…}`, `{...spread}`, or `name="…"`. Stepping over it
    // needs no `return`: an opener that is not there leaves the walk before the start of the file,
    // which the top of the loop already answers.
    if (code === 125 /* } */ || code === 34 /* " */ || code === 39 /* ' */) {
      index = beforeOpening(source, index);
      continue;
    }

    if (!isNameCharacter(code) && code !== 46 /* . */) return false;

    /**
     * A name: the tag's own, which ends the search, or an attribute written before this one —
     * a bare `disabled`, or the name belonging to a value already stepped over.
     */
    while (index >= 0 && (isNameCharacter(source.charCodeAt(index)) || source.charCodeAt(index) === 46)) index--;
    if (index >= 0 && source.charCodeAt(index) === 60 /* < */) return true;
  }
}

/**
 * The offset just before whatever opened the value ending at `at`, or -1 when nothing did.
 *
 * One function for both shapes, because both are the same question and the answer for "there is no
 * opener" has to be the same: braces are counted, since an attribute's expression holds its own, and
 * a quote closes itself.
 */
function beforeOpening(source: string, at: number): number {
  const code = source.charCodeAt(at);

  if (code === 123 /* { */ || code === 125 /* } */) {
    let depth = 0;
    for (let index = at; index >= 0; index--) {
      const here = source.charCodeAt(index);
      if (here === 125 /* } */) depth++;
      else if (here === 123 /* { */ && --depth === 0) return index - 1;
    }
  } else {
    for (let index = at - 1; index >= 0; index--) {
      if (source.charCodeAt(index) === code && source.charCodeAt(index - 1) !== 92 /* \\ */) return index - 1;
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
