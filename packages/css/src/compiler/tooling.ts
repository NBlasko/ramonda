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
  /** The formatter's output with the blocks put back, at the indentation it chose. */
  restore(formatted: string): string;
}

/** `undefined` when the file holds no block, which is when a formatter needs no help. */
export function placehold(source: string): Placeheld | undefined {
  if (!mayHoldABlock(source)) return undefined;

  const sites = findBlocks(source);
  if (sites.length === 0) return undefined;

  const marker = markerFor(source);
  const blocks: string[] = [];
  let text = "";
  let cursor = 0;

  for (const site of sites) {
    if (site.start < cursor) continue;

    // Tolerant: a formatter is the tool most likely to run on a file mid-edit — save on keystroke —
    // and refusing there would be refusing whenever it matters most.
    const read = readBlock(source, site.open, "", { tolerant: true });
    const end = read.end + 1;

    text += source.slice(cursor, site.start);
    text += `${site.name}={/*${marker}${blocks.length}*/ 0}`;
    blocks.push(source.slice(site.start, end));
    cursor = end;
  }

  text += source.slice(cursor);

  return { text, restore: (formatted) => restore(formatted, blocks, marker) };
}

function restore(formatted: string, blocks: readonly string[], marker: string): string {
  let out = formatted;

  for (const [index, block] of blocks.entries()) {
    const placeholder = new RegExp(`[\\w:$-]+=\\{/\\*${marker}${index}\\*/ 0\\}`);
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

    out = out.slice(0, found.index) + relaid(block, outer, inner) + out.slice(found.index + found[0].length);
  }

  return out;
}

/**
 * One block at the indentation the formatter settled on.
 *
 * The first line stays as it is — it begins where the placeholder was, which the formatter has
 * already positioned. The last takes the outer indentation, because it closes what the first opened.
 * Everything between is one step in.
 *
 * A one-line block is returned untouched: there is no inside to indent, and adding a newline would
 * be the formatter's decision to make rather than this one's.
 */
function relaid(block: string, outer: string, inner: string): string {
  const lines = block.split("\n");
  if (lines.length === 1) return block;

  return lines
    .map((line, index) => {
      if (index === 0) return line;
      return index === lines.length - 1 ? outer + line.trim() : inner + line.trim();
    })
    .join("\n");
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
