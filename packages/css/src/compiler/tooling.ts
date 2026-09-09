import { canonicalCondition, canonicalSelector } from "./normalise";
import { closingHole, opensAHole, readBlock } from "./read";
import { findBlocks, mayHoldABlock } from "./scan";

/**
 * A hole with its braces against the expression, whatever was typed.
 *
 * **Reported by a user, who had the same condition four ways in one file**: `@@if ({ this.roomy})`,
 * `@@if ({this.roomy })`, and both of the tidy spellings — because the formatter left every one of
 * them alone. Measured before this: all four survived unchanged.
 *
 * Against the braces, and not `{ … }`, because a hole is the escape JSX already uses in the same
 * place — `css={@@( … )}`, `{this.tone}` — and JSX writes it tight. An object literal's spacing is a
 * different convention for a different thing; this is a delimiter.
 *
 * The whitespace immediately inside the braces is not part of the expression, so trimming it changes
 * nothing that runs. **One shape keeps its space**: an expression that itself begins or ends with a
 * brace, where trimming would produce `{{` or `}}` — a reader meeting that, in a language whose
 * holes were spelled `{{ }}` until this morning, deserves better than two characters saved.
 */
function tightened(hole: string): string {
  const inner = hole.slice(1, -1);
  const trimmed = inner.trim();
  if (trimmed === inner) return hole;
  if (trimmed.startsWith("{") || trimmed.endsWith("}")) return hole;
  return `{${trimmed}}`;
}

/**
 * Handing a style block to a formatter, which is a different problem from handing it to a checker.
 *
 * ## Why this is not the virtual file
 *
 * A linter gets the virtual file and its diagnostics are mapped home, exactly as `tsc`'s are — one
 * mechanism, already written. A formatter cannot work that way: it **rewrites text** rather than
 * reporting positions in it, so there is nothing to map back through. What comes out is a new file,
 * and the block has to be in it.
 *
 * So the block is replaced by something that parses, the file is formatted normally, and the block is
 * put back where the placeholder ended up.
 *
 * ## And a suppression comment cannot substitute for either half
 *
 * `biome-ignore` and `oxlint-disable` are read BY the parser, and the parser fails before it reaches
 * them. Measured: biome answers *"Code formatting aborted due to parsing errors"* with the comments
 * in place. It is also what makes the comparison with a CSS-in-a-backtick library misleading — a
 * tagged template is already valid TypeScript, so the tool parses the file, sees a string and looks
 * no further. Here there is no region to ignore, because there is no region at all.
 */

export interface Placeheld {
  /** The file with every block replaced by something that parses. Hand this to the formatter. */
  readonly text: string;
  /**
   * Each block's own `@@( … )` text, in the order the placeholders were numbered — never the name in
   * front of it, even where the placeholder took that too. A caller printing a placeholder back is
   * printing it INSIDE whatever the placeholder occupies, so the name is already there.
   */
  readonly blocks: readonly string[];
  /** The formatter's output with the blocks put back, at the indentation it chose. */
  restore(formatted: string): string;
}

export interface PlaceholdOptions {
  /**
   * What stands in for a block, given its number and whether the block spans lines. The default is
   * a comment and a zero for a one-line block, and a template literal holding a newline for one
   * that spans lines — see `placehold` for why the shape has to carry that much.
   *
   * A caller that puts the block back ITSELF wants something else. Prettier is the one that does —
   * it has no hook that sees the printed text, so its plugin recognises the placeholder as a NODE
   * and prints the block in its place, which needs a node rather than a comment on one.
   */
  stands?(index: number, multiline: boolean): string;
  /**
   * Whether a bare JSX attribute keeps the braces the placeholder needs.
   *
   * True by default, which is what a formatter run over the whole file wants: a commented zero in
   * braces is a legal attribute value, and `restore` puts the author's own spelling back afterwards.
   *
   * A caller whose placeholder is a value in its own right can do better — a quoted string is a legal
   * attribute value too, so nothing about the site changes and the block goes back exactly as it was
   * written.
   */
  braces?: boolean;
}

/** `undefined` when the file holds no block, which is when a formatter needs no help. */
export function placehold(source: string, options: PlaceholdOptions = {}): Placeheld | undefined {
  if (!mayHoldABlock(source)) return undefined;

  const sites = findBlocks(source);
  if (sites.length === 0) return undefined;

  const marker = markerFor(source);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  /**
   * A placeholder has to carry the block's SHAPE, not only its place.
   *
   * **Reported by a user**: `className="panel"` and `css={@@( … )}` could not be kept one per line —
   * "kao da nas eteti tera ostale da idu inline". They were right, and it was ours. The formatter
   * never sees a block, it sees this; and a comment and a zero is fourteen characters, so an opening
   * element that is multi-line in the author's file measured as fitting on one. biome joined the
   * attributes exactly as it should have, and the block was expanded again afterwards, past a width
   * nobody re-measured. An element carrying a block and one other attribute is the ordinary case.
   *
   * So a block that spans lines is placeheld by something that spans lines. A template literal,
   * because its contents are the one thing a formatter will not re-lay: measured against the two
   * alternatives, a multi-line comment and a padded one both make biome break the braces open —
   * `css={` on its own line, which the author did not write either.
   *
   * A ONE-LINE block keeps the short placeholder. `css=@@( display: flex; )` beside another
   * attribute is a line the author chose, and whether it still fits is the formatter's own call.
   */
  const stands =
    options.stands ??
    ((index: number, multiline: boolean) =>
      multiline ? `\`${marker}${index}${newline}\`` : `/*${marker}${index}*/ 0`);
  const blocks: { text: string; block: string; wrap: boolean; held: string }[] = [];
  let text = "";
  let cursor = 0;

  for (const site of sites) {
    if (site.start < cursor) continue;

    // Tolerant: a formatter is the tool most likely to run on a file mid-edit — save on keystroke —
    // and refusing there would be refusing whenever it matters most.
    const read = readBlock(source, site.open, "", { tolerant: true });
    const end = read.end + 1;
    /**
     * What the site owns, which is the transform's rule and has to be: a bare JSX attribute owns its
     * name, because the braces are ours to add; the two expression spellings own only the block. A
     * placeholder that swallowed the author's own `}` in `css={@@( … )}` leaves an extra one behind —
     * measured, biome then refuses the file for the very parse error this exists to avoid.
     */
    const wrap = site.wrap && options.braces !== false;
    const from = site.start;
    const block = source.slice(site.opening, end);
    const held = stands(blocks.length, block.includes("\n"));

    text += source.slice(cursor, from);
    text += wrap ? `${site.name}={${held}}` : held;
    blocks.push({ text: source.slice(from, end), block, wrap, held });
    cursor = end;
  }

  text += source.slice(cursor);

  return {
    text,
    blocks: blocks.map((held) => held.block),
    restore: (formatted) => restore(formatted, blocks),
  };
}

function restore(formatted: string, blocks: readonly { text: string; wrap: boolean; held: string }[]): string {
  let out = formatted;
  /**
   * The ending the FORMATTER chose, which is the one the whole file now uses.
   *
   * `relaid` used to take it from the block's own text, and a review measured what that costs: a
   * CRLF file formatted by a tool that writes LF came back LF outside every block and CRLF inside
   * one. Stable, which is worse than random — it recurs on every save rather than healing.
   *
   * The existing tests could not see it, because they all use an identity formatter, and an identity
   * formatter never disagrees with the block. A tool with an opinion is the only way to reach it.
   *
   * A file with one line and no newline at all keeps whatever the block had, which is the only case
   * where the formatter has said nothing.
   */
  const newline = formatted.includes("\r\n") ? "\r\n" : formatted.includes("\n") ? "\n" : undefined;
  // From the text as the FORMATTER left it, before any block goes back into it — a restored block's
  // own body would otherwise be read as evidence of what the formatter chose.
  const spaces = stepOf(formatted);

  for (const block of blocks) {
    /**
     * Built from what was actually emitted rather than from a second spelling of it — the caller may
     * have supplied its own `stands`, and two descriptions of one placeholder is this repository's
     * recurring fault in miniature. A newline is matched either way it survives the formatter, which
     * may have written the file back with the other ending.
     */
    const stands = block.held.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\r?\n/g, "\\r?\\n");
    const placeholder = new RegExp(block.wrap ? `[\\w:$-]+=\\{${stands}\\}` : stands);
    const found = placeholder.exec(out);
    /**
     * A placeholder the formatter moved, rewrote or deleted. There is no correct output to fall back
     * to, so there is no output.
     *
     * This used to `continue`: the block was dropped, the placeholder was left where it had been,
     * and `formatFile` with `write: true` put that on disk. A review measured it with the real
     * Prettier, which reads the template placeholder as embedded CSS and reflows it — two of six
     * cases lost their block.
     *
     * A formatter that fails is an inconvenience. A formatter that eats a block is unrecoverable
     * work, and it was doing it silently, which is the half that makes it unrecoverable. The test
     * that covered the old behaviour asserted the block was gone while its own comment said losing
     * an author's source is the one outcome this may not have; the comment was right.
     */
    if (found === null) {
      throw new Error(
        "[@ramonda/css] the formatter moved or rewrote the placeholder standing in for a style " +
          "block, so the block cannot be put back and nothing was written. This is a formatter " +
          "this package has not been measured against — please report it with the file.",
      );
    }

    /**
     * The formatter's own indentation, copied rather than counted.
     *
     * It may have chosen tabs, and a block re-laid with spaces inside a tabbed file is a file the
     * formatter will disagree with on the next run — an edit that never settles.
     */
    const lineStart = out.lastIndexOf("\n", found.index) + 1;
    const outer = /^[\t ]*/.exec(out.slice(lineStart, found.index))?.[0] ?? "";
    const inner = outer + (outer.includes("\t") ? "\t" : spaces);

    out =
      out.slice(0, found.index) + relaid(block.text, outer, inner, newline) + out.slice(found.index + found[0].length);
  }

  return out;
}

/**
 * How wide one level is, read off the file the formatter has just laid out.
 *
 * The narrowest indentation in it, because the shallowest indented line in a file is one level in.
 * Two spaces when there is nothing to read — a file with no indented line at all, which is a block
 * at the left margin.
 *
 * **The config used to have a `format: { indent }` for this, and nothing read it.** Wiring it up
 * would have been the wrong repair: the project has already told biome or prettier how wide a level
 * is, and a second place to say it can only disagree with the first. This asks the answer that is
 * already in the file.
 *
 * A single space is not a level anywhere, and it is what a line inside a template literal or a
 * wrapped comment can easily start with, so it is not read as one.
 */
function stepOf(text: string): string {
  let narrowest = 0;
  for (const line of text.split("\n")) {
    const width = /^ +/.exec(line)?.[0].length ?? 0;
    if (width >= 2 && (narrowest === 0 || width < narrowest)) narrowest = width;
  }
  return " ".repeat(narrowest === 0 ? 2 : narrowest);
}

/**
 * One block at the indentation the formatter settled on, and its CSS laid out inside that.
 *
 * The first line stays as it is — it begins where the placeholder was, which the formatter has
 * already positioned. Everything after it is re-laid, and the last line closes what the first opened.
 *
 * **A one-line block is returned untouched.** `css=@@( display: flex; )` is a deliberate shape and
 * breaking it would be the formatter having an opinion about the markup rather than about the CSS.
 *
 * **The block's own line ending is what it is put back together with.** Splitting on `\n` and
 * joining on `\n` cost every body line its `\r` in a CRLF checkout — measured with an identity
 * formatter, which is the only way to see it: the file came back with mixed endings inside each
 * block, a diff on every line and a lint failure in most setups. Nothing here is a decision about
 * which ending a file should use.
 */
function relaid(block: string, outer: string, inner: string, chosen: string | undefined): string {
  // The file's own ending — see `restore`, which reads it off what the formatter handed back. Only a
  // file with no newline at all falls back to the block's, because there the formatter said nothing.
  const newline = chosen ?? (block.includes("\r\n") ? "\r\n" : "\n");
  const lines = block.split(/\r?\n/);
  if (lines.length === 1) return block;

  const step = inner.slice(outer.length);
  const body = lines.slice(1, -1).join(newline);

  return [lines[0], ...layout(body, inner, step), outer + lines[lines.length - 1].trim()].join(newline);
}

/**
 * The CSS between a block's parens, one declaration to a line and a nested rule's body one step in.
 *
 * ## Why it works on the TEXT rather than on the parse
 *
 * The parser drops comments — measured, a block comment between two declarations is not in the AST at
 * all — so a layout emitted from the parse would delete the author's own notes. Everything here is
 * the author's bytes with the whitespace between them rewritten.
 *
 * ## What is not structure
 *
 * A `;` or a brace inside a hole, a string, a comment or a function is not a boundary, and treating
 * one as a boundary is how a formatter breaks working code. Each of those is stepped over whole,
 * which is also what keeps `{{ … }}` byte-for-byte: the expression inside it is TypeScript and none
 * of this may touch it.
 */
function layout(body: string, indent: string, step: string): string[] {
  const out: string[] = [];
  let line = "";
  let depth = 0;
  let parens = 0;
  /**
   * Whether this physical line has produced anything yet.
   *
   * Without it, the newline after a `;` reads as a blank line the author wrote — `line` is empty by
   * then, because emitting cleared it — and every declaration gains one below it.
   */
  let fresh = true;
  /** Whether a line was already emitted on this physical line — see the comment branch. */
  let emitted = false;

  /** The line so far, at its depth — or a blank line, which carries no indentation of its own. */
  const emit = (): void => {
    const text = line.trim();
    line = "";
    if (text === "") return;
    out.push(indent + step.repeat(depth) + text);
    emitted = true;
  };

  /** A blank line the author wrote, kept once however many they wrote. */
  const blank = (): void => {
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
  };

  for (let index = 0; index < body.length; index++) {
    const code = body.charCodeAt(index);

    if (code === 47 /* / */ && body.charCodeAt(index + 1) === 42 /* * */) {
      /**
       * A comment on a line of its own stays on one, and one at the end of a declaration stays
       * there. The difference is whether anything came BEFORE it on this line — which is what
       * `fresh` already knows, and what the first version of this got wrong: every standalone
       * comment came back glued to the declaration below it, which is the one thing a note above a
       * declaration must not become.
       */
      const alone = fresh;
      const end = body.indexOf("*/", index + 2);
      const stop = end === -1 ? body.length : end + 2;
      const comment = body.slice(index, stop);
      index = stop - 1;
      fresh = false;

      /**
       * A comment AFTER a declaration belongs to the line it was written on, and by the time it is
       * read that line has already been emitted — the `;` ended it. So it is appended to what was
       * emitted rather than started as a line of its own.
       */
      if (line.trim() === "" && emitted && out.length > 0) {
        out[out.length - 1] += ` ${comment}`;
        continue;
      }

      line += comment;
      if (alone) emit();
      continue;
    }

    if (code !== 10 /* \n */ && code !== 32 && code !== 9) fresh = false;

    if (code === 34 /* " */ || code === 39 /* ' */) {
      const stop = endOfString(body, index);
      line += body.slice(index, stop);
      index = stop - 1;
      continue;
    }

    if (code === 123 /* { */ && opensAHole(line)) {
      const close = closingHole(body, index);
      const stop = close === -1 ? body.length : close;
      line += tightened(body.slice(index, stop));
      index = stop - 1;
      continue;
    }

    if (code === 40 /* ( */) {
      parens++;
      line += "(";
      continue;
    }
    if (code === 41 /* ) */) {
      parens = Math.max(0, parens - 1);
      line += ")";
      continue;
    }

    if (parens === 0 && code === 123 /* { */) {
      /**
       * A prelude, written the one way it may be written — see `canonicalCondition`.
       *
       * The same functions the `non-canonical-spelling` rule asks, so the rule reports exactly what
       * this writes and the two cannot disagree about what canonical means. That matters more than
       * either half: a rule reporting a spelling the formatter would not fix is an error with no
       * fix, and a formatter rewriting something no rule asked for is a diff nobody wanted.
       */
      const written = line.trim();
      const canonical = written.startsWith("@") ? canonicalCondition(written) : canonicalSelector(written);
      line = `${canonical} {`;
      emit();
      depth++;
      continue;
    }

    if (parens === 0 && code === 125 /* } */) {
      emit();
      depth = Math.max(0, depth - 1);
      out.push(indent + step.repeat(depth) + "}");
      continue;
    }

    if (parens === 0 && code === 59 /* ; */) {
      line = `${line.trim()};`;
      emit();
      continue;
    }

    if (code === 10 /* \n */) {
      if (fresh) blank();
      else if (line.trim() !== "") line += " ";
      fresh = true;
      emitted = false;
      continue;
    }

    /**
     * A run of whitespace inside a value is collapsed to one space.
     *
     * Removing whitespace is safe; adding it is an opinion. `rgb(1,2,3)` keeps the spacing the author
     * chose — this only takes away what nobody meant, which is `4px     0   ;`.
     *
     * Only here, and that is the point: a string, a hole and a comment were appended whole further
     * up and are never looked at again, so their own spacing is untouched.
     */
    if (code === 32 || code === 9) {
      if (line !== "" && !line.endsWith(" ")) line += " ";
      continue;
    }

    line += String.fromCharCode(code);
  }

  emit();
  // A trailing blank line would put an empty one before the closing paren, which nobody wrote.
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/** Past the closing quote of the string starting at `at`, or the end of the text. */
function endOfString(text: string, at: number): number {
  const quote = text.charCodeAt(at);
  for (let index = at + 1; index < text.length; index++) {
    if (text.charCodeAt(index) === 92 /* \\ */) index++;
    else if (text.charCodeAt(index) === quote) return index + 1;
  }
  return text.length;
}

/**
 * A marker the file does not already contain.
 *
 * It goes into the text the FORMATTER sees, so an author who happened to write the same characters
 * would get somebody else's block back where theirs was. Growing it until the file does not hold it
 * costs one search and removes the question.
 */
function markerFor(source: string): string {
  let marker = "@ramonda-css:";
  while (source.includes(marker)) marker += "!";
  return marker;
}
