import { readBlock } from "./read";
import { findBlocks, mayHoldABlock } from "./scan";

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
   * Each block's own `@( … )` text, in the order the placeholders were numbered — never the name in
   * front of it, even where the placeholder took that too. A caller printing a placeholder back is
   * printing it INSIDE whatever the placeholder occupies, so the name is already there.
   */
  readonly blocks: readonly string[];
  /** The formatter's output with the blocks put back, at the indentation it chose. */
  restore(formatted: string): string;
}

export interface PlaceholdOptions {
  /**
   * What stands in for a block, given its number. The default is a comment and a zero, which is what
   * a formatter run over the whole file needs: it parses, it survives, and `restore` finds it again.
   *
   * A caller that puts the block back ITSELF wants something else. Prettier is the one that does —
   * it has no hook that sees the printed text, so its plugin recognises the placeholder as a NODE
   * and prints the block in its place, which needs a node rather than a comment on one.
   */
  stands?(index: number): string;
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
  const stands = options.stands ?? ((index: number) => `/*${marker}${index}*/ 0`);
  const blocks: { text: string; block: string; wrap: boolean }[] = [];
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
     * placeholder that swallowed the author's own `}` in `css={@( … )}` leaves an extra one behind —
     * measured, biome then refuses the file for the very parse error this exists to avoid.
     */
    const wrap = site.wrap && options.braces !== false;
    const from = wrap ? site.start : site.open - 1;
    const held = stands(blocks.length);

    text += source.slice(cursor, from);
    text += wrap ? `${site.name}={${held}}` : held;
    blocks.push({ text: source.slice(from, end), block: source.slice(site.open - 1, end), wrap });
    cursor = end;
  }

  text += source.slice(cursor);

  return {
    text,
    blocks: blocks.map((held) => held.block),
    restore: (formatted) => restore(formatted, blocks, marker),
  };
}

function restore(formatted: string, blocks: readonly { text: string; wrap: boolean }[], marker: string): string {
  let out = formatted;

  for (const [index, block] of blocks.entries()) {
    const stands = `/\\*${marker}${index}\\*/ 0`;
    const placeholder = new RegExp(block.wrap ? `[\\w:$-]+=\\{${stands}\\}` : stands);
    const found = placeholder.exec(out);
    if (found === null) continue;

    /**
     * The formatter's own indentation, copied rather than counted.
     *
     * It may have chosen tabs, and a block re-laid with spaces inside a tabbed file is a file the
     * formatter will disagree with on the next run — an edit that never settles.
     */
    const lineStart = out.lastIndexOf("\n", found.index) + 1;
    const outer = /^[\t ]*/.exec(out.slice(lineStart, found.index))?.[0] ?? "";
    const inner = outer + (outer.includes("\t") ? "\t" : "  ");

    out = out.slice(0, found.index) + relaid(block.text, outer, inner) + out.slice(found.index + found[0].length);
  }

  return out;
}

/**
 * One block at the indentation the formatter settled on, and its CSS laid out inside that.
 *
 * The first line stays as it is — it begins where the placeholder was, which the formatter has
 * already positioned. Everything after it is re-laid, and the last line closes what the first opened.
 *
 * **A one-line block is returned untouched.** `css=@( display: flex; )` is a deliberate shape and
 * breaking it would be the formatter having an opinion about the markup rather than about the CSS.
 */
function relaid(block: string, outer: string, inner: string): string {
  const lines = block.split("\n");
  if (lines.length === 1) return block;

  const step = inner.slice(outer.length);
  const body = lines.slice(1, -1).join("\n");

  return [lines[0], ...layout(body, inner, step), outer + lines[lines.length - 1].trim()].join("\n");
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

  /** The line so far, at its depth — or a blank line, which carries no indentation of its own. */
  const emit = (): void => {
    const text = line.trim();
    line = "";
    if (text !== "") out.push(indent + step.repeat(depth) + text);
  };

  /** A blank line the author wrote, kept once however many they wrote. */
  const blank = (): void => {
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
  };

  for (let index = 0; index < body.length; index++) {
    const code = body.charCodeAt(index);

    if (code !== 10 /* \n */ && code !== 32 && code !== 9) fresh = false;

    if (code === 47 /* / */ && body.charCodeAt(index + 1) === 42 /* * */) {
      const end = body.indexOf("*/", index + 2);
      const stop = end === -1 ? body.length : end + 2;
      line += body.slice(index, stop);
      index = stop - 1;
      // A comment on a line of its own stays on one.
      if (line.trim() === body.slice(index + 1 - (stop - index), stop).trim()) emit();
      continue;
    }

    if (code === 34 /* " */ || code === 39 /* ' */) {
      const stop = endOfString(body, index);
      line += body.slice(index, stop);
      index = stop - 1;
      continue;
    }

    if (code === 123 /* { */ && body.charCodeAt(index + 1) === 123) {
      const stop = endOfHole(body, index);
      line += body.slice(index, stop);
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
      line = `${line.trim()} {`;
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

/** Past the `}}` closing the hole starting at `at`, or the end of the text. */
function endOfHole(text: string, at: number): number {
  const close = text.indexOf("}}", at + 2);
  return close === -1 ? text.length : close + 2;
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
