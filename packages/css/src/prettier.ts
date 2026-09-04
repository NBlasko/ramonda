import { doc } from "prettier";
import * as babel from "prettier/plugins/babel";
import * as estree from "prettier/plugins/estree";
import * as typescript from "prettier/plugins/typescript";
import type { AstPath, Doc, Options, Parser, Plugin, Printer } from "prettier";
import { placehold } from "./compiler/tooling";

/**
 * Prettier, taught the syntax — the third tool that cannot parse a file holding a block.
 *
 * ## The fault this exists for
 *
 * Measured on a real file: `prettier --parser typescript` answers *"SyntaxError: ')' expected."* and
 * refuses. That is the safe half — nothing is mangled and nothing is lost — but it breaks the one
 * gesture every editor offers, and an editor whose default formatter is Prettier gives that answer on
 * save. `ramonda-css format` exists for this repository's own tools; this exists for everybody else's.
 *
 * ## Why a PRINTER rather than a preprocessor
 *
 * Replacing every block with something that parses is the easy half. Putting them back is the
 * problem, because **Prettier has no hook that sees the printed text** — a plugin gets an AST and
 * returns a document, and the core turns that into a string.
 *
 * So the placeholder has to be a NODE rather than a comment on one, and `embed` is what prints it.
 * `embed` is Prettier's own way of printing a node in another language, which is exactly what this
 * is: asked about the string literal standing in for a block, it hands back the block's own lines,
 * and Prettier lays them out where the node was, at the indentation it chose for that position.
 *
 * The block's inside is returned as written. It is CSS, and re-laying CSS is `ramonda-css format`'s
 * business rather than a JavaScript printer's.
 */

/**
 * What stands in for a block: a TEMPLATE literal, and the choice is measured.
 *
 * A plain string works everywhere except where it matters. Prettier prints a JSX attribute's quoted
 * value itself and never asks `embed` about it, so a bare `css="…"` came back as the placeholder. And
 * a braced string breaks its braces onto their own lines, because only a few node types are allowed
 * to hug them — a template literal is one, which is how every CSS-in-a-backtick plugin gets the
 * layout it does.
 *
 * The cost is that Prettier normalises `css=@( … )` to `css={@( … )}`. The two compile to the same
 * class, and the braced one is what to reach for anyway — see README.
 */
const STANDS = "@ramonda-css-block:";

/** Each file's blocks, hung on the options object Prettier threads from the parser to the printer. */
const BLOCKS = Symbol.for("ramonda.css.blocks");

type Carried = Options & { [BLOCKS]?: readonly string[] };

/** Every parser that can be pointed at a file holding a block. */
const PARSERS: Record<string, Parser> = {
  typescript: typescript.parsers.typescript,
  babel: babel.parsers.babel,
  "babel-ts": babel.parsers["babel-ts"],
};

const printer = (estree as unknown as { printers: { estree: Printer } }).printers.estree;

const plugin: Plugin = {
  parsers: Object.fromEntries(
    Object.entries(PARSERS).map(([name, parser]) => [
      name,
      {
        ...parser,
        /**
         * A file holding no block is left exactly as Prettier had it, including the answer — the
         * substring search first, as everywhere else, so a codebase using none of this pays for one.
         */
        preprocess(text: string, options: Options) {
          const placeheld = placehold(text, {
            stands: (index) => `\`${STANDS}${index}\``,
          });
          if (placeheld === undefined) return text;

          (options as Carried)[BLOCKS] = placeheld.blocks;
          return placeheld.text;
        },
      },
    ]),
  ),
  printers: {
    estree: {
      ...printer,
      embed(path: AstPath, options: Options) {
        const block = blockAt(path, options as Carried);
        if (block === undefined) return printer.embed?.(path, options) ?? null;

        return () => laid(block);
      },
    },
  },
};

/** The block a node stands for, or nothing when it is an ordinary template literal. */
function blockAt(path: AstPath, options: Carried): string | undefined {
  const node = path.node as { type?: string; quasis?: { value?: { raw?: string } }[] };
  if (node.type !== "TemplateLiteral" || node.quasis?.length !== 1) return undefined;

  const raw = node.quasis[0].value?.raw;
  if (raw === undefined || !raw.startsWith(STANDS)) return undefined;

  return options[BLOCKS]?.[Number(raw.slice(STANDS.length))];
}

/**
 * One block as a document: its first line where the node was, its inside one step in, and its last
 * line back out.
 *
 * The block's own relative shape is kept and its absolute indentation is not — the printer has just
 * decided where this sits, and re-using the author's columns would drift a step further in every
 * time somebody formatted the file. What is deliberately NOT done is re-laying the CSS itself: that
 * is `ramonda-css format`'s business rather than a JavaScript printer's.
 */
function laid(block: string): Doc {
  const [first, ...rest] = block.split("\n");
  if (rest.length === 0) return first;

  const last = rest[rest.length - 1];
  const middle = rest.slice(0, -1);
  const { hardline, indent } = doc.builders;

  return [first, indent(middle.flatMap((line) => [hardline, line.trim()])), hardline, last.trim()];
}

export default plugin;
