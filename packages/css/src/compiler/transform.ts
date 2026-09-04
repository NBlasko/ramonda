import MagicString from "magic-string";
import { classNameFor, substitute, variableNameFor } from "./names";
import { normalise } from "./normalise";
import { readBlock } from "./read";
import { refuse } from "./errors";
import { type BlockSite, findBlocks, mayHoldABlock } from "./scan";

/**
 * An author's file in, valid TSX out, plus the rules it now owes a stylesheet.
 *
 * This is the same transform six things run: the build, `tsc` through a virtual file, the editor,
 * `ramonda-check`, the test runner and the documentation gate. There is exactly one of it on
 * purpose — a second reading of the syntax is a second answer to what a file means.
 *
 * ## The rule that decides the whole shape of the output
 *
 * **Only the CSS between the expressions is replaced. No expression's bytes move.** Overwriting a
 * block in one span is the obvious thing and it costs the mapping: measured, a hole then reported
 * the block's opening line instead of its own — line 8 for something written on line 13. Writing
 * the gaps out one at a time costs nothing and is what makes the source map exact.
 *
 * ## The map's resolution, which is not the obvious setting
 *
 * Generating the map is about half the transform's whole cost, so the three settings were measured
 * rather than picked. All three get every LINE right, including inside an expression spanning four
 * of them — magic-string emits a mapping at each line start whatever it is told. The difference is
 * columns, on lines this never touched:
 *
 *     hires: true        every column exact      1393 chars of mappings   22.0 µs/file
 *     hires: "boundary"  every column exact       723 chars              22.2 µs/file
 *     hires: false       every column -> 0         97 chars              16.4 µs/file
 *
 * `false` is the cheap one and it collapses `one(two(), three())` to the start of its line — for the
 * whole file, not only near a block, because this map sits above the bundler's. `boundary` costs the
 * same as `true` and carries half the mappings, so it is what is used.
 */

export interface TransformOptions {
  /** For the source map and for what a refusal says. */
  readonly filename?: string;
  /** Where `block` is imported from. A wrapper for another JSX library points this at itself. */
  readonly runtime?: string;
}

/** One rule the stylesheet now owes. Assembly (dedupe, `@layer`, the collision assertion) is track E. */
export interface EmittedBlock {
  /** `r-` plus 16 hex — see CONTRACT.md. */
  readonly className: string;
  /** The rule's body, custom properties substituted, nested rules still nested. */
  readonly css: string;
  /** The custom property names this rule reads, in hole order. */
  readonly properties: readonly string[];
}

/**
 * Declared here rather than re-exported, so the published types do not carry the map generator's.
 * The fields are the source map specification's own.
 */
export interface SourceMap {
  readonly version: number;
  readonly file?: string;
  readonly sources: readonly (string | null)[];
  readonly sourcesContent?: readonly (string | null)[];
  readonly names: readonly string[];
  readonly mappings: string;
}

export interface TransformResult {
  readonly code: string;
  readonly map: SourceMap;
  readonly blocks: readonly EmittedBlock[];
}

/**
 * `undefined` when there is nothing to do, which is the answer almost every time.
 *
 * A codebase that uses none of this pays one substring search per file: measured on this repository
 * before any of it existed, 1,268 files and 10.61 MB in **1.33 ms**. A plugin returning `undefined`
 * here hands the file on untouched, with no map to compose and no string to rebuild.
 */
export function transform(source: string, options: TransformOptions = {}): TransformResult | undefined {
  if (!mayHoldABlock(source)) return undefined;

  const filename = options.filename ?? "unknown.tsx";
  const sites = findBlocks(source);
  if (sites.length === 0) return undefined;

  const magic = new MagicString(source);
  const block = binding(source, "_block");
  const prefix = identifierPrefix(source);

  /** Class name -> the descriptor that stands for it, so a block written twice is emitted once. */
  const descriptors = new Map<string, { id: string; emitted: EmittedBlock }>();
  const order: { id: string; emitted: EmittedBlock }[] = [];
  /** The end of the block read last, so a `name=@(` found INSIDE one is not read as another. */
  let consumed = 0;

  for (const site of sites) {
    if (site.start < consumed) {
      refuse(
        "a block cannot contain another block — a hole holds a value, and a nested `@( … )` is not one.",
        source,
        site.start,
        filename,
      );
    }

    const read = readBlock(source, site.open, filename);
    consumed = read.end + 1;

    // Normalised ONCE. It was called twice — for the name and again for the rule — and normalisation
    // walks the whole block, so that was a second full pass per block for a string already in hand.
    const canonical = normalise(read.block);
    const className = classNameFor(canonical);
    const properties = read.holes.map((_hole, index) => variableNameFor(className, index));

    let descriptor = descriptors.get(className);
    if (descriptor === undefined) {
      descriptor = {
        id: `${prefix}${descriptors.size}`,
        emitted: { className, css: substitute(canonical, className), properties },
      };
      descriptors.set(className, descriptor);
      order.push(descriptor);
    }

    write(magic, site, descriptor.id, read.holes, read.end);
  }

  const prologue =
    `import { block as ${block} } from "${options.runtime ?? "@ramonda/css"}";\n` +
    `${order.map((each) => declare(block, each.id, each.emitted)).join("\n")}\n\n`;

  const top = afterDirectives(source);
  if (top === 0) magic.prepend(prologue);
  else magic.appendRight(top, prologue);

  return {
    code: magic.toString(),
    map: magic.generateMap({ source: filename, includeContent: true, hires: "boundary" }) as unknown as SourceMap,
    blocks: order.map((each) => each.emitted),
  };
}

/**
 * The site rewritten, in as many pieces as there are gaps.
 *
 * A block with no holes is not a call: the descriptor IS the value, so the site reads `css={_s0}`
 * and the program allocates once however many elements carry the class. See CONTRACT.md.
 *
 * **What is replaced depends on how the block was written.** A bare JSX attribute needs braces the
 * author did not write, so the NAME is replaced too and the site becomes `css={_s0}`. The two
 * expression spellings — `css={@( … )}` and `const panel = @( … )` — need nothing but the value, so
 * only the block itself is replaced and everything to its left is the author's own text. Wrapping
 * one of those would turn a value into an object literal.
 */
function write(
  magic: MagicString,
  site: BlockSite,
  id: string,
  holes: readonly { start: number; end: number }[],
  end: number,
): void {
  const start = site.wrap ? site.start : site.open - 1;
  const head = site.wrap ? `${site.name}={${id}` : id;
  const tail = site.wrap ? "}" : "";

  if (holes.length === 0) {
    magic.overwrite(start, end + 1, `${head}${tail}`);
    return;
  }

  magic.overwrite(start, holes[0].start, `${head}(`);
  for (let index = 0; index < holes.length - 1; index++) {
    magic.overwrite(holes[index].end, holes[index + 1].start, ", ");
  }
  magic.overwrite(holes[holes.length - 1].end, end + 1, `)${tail}`);
}

function declare(block: string, id: string, emitted: EmittedBlock): string {
  const names = emitted.properties.map((property) => JSON.stringify(property)).join(", ");
  const args = names === "" ? "" : `, [${names}]`;
  return `const ${id} = ${block}(${JSON.stringify(emitted.className)}${args});`;
}

/**
 * A name for the descriptors that the file does not already use.
 *
 * `_s0` is what CONTRACT.md shows and what a person reading the output expects, so it is the base
 * and it only grows when it has to — a file that already says `_s` gets `_s_`, and so on. Checking
 * the whole source for the PREFIX rather than for each name is what makes one check enough for all
 * of them.
 */
function identifierPrefix(source: string): string {
  let prefix = "_s";
  while (source.includes(prefix)) prefix += "_";
  return prefix;
}

function binding(source: string, base: string): string {
  let name = base;
  while (source.includes(name)) name = `_${name}`;
  return name;
}

/**
 * Where the hoisted prologue may start: after a shebang and after a directive prologue.
 *
 * `"use client"` is a directive only while nothing precedes it, so prepending in front of one turns
 * it into an ordinary string expression and the file quietly stops being what it said it was. The
 * imports themselves need no such care — an `import` declaration is hoisted, so a `const` written
 * above one still sees its bindings.
 */
function afterDirectives(source: string): number {
  let at = source.startsWith("#!") ? nextLine(source, 0) : 0;

  for (;;) {
    const from = at;
    at = skipTrivia(source, at);
    const quote = source.charCodeAt(at);
    if (quote !== 34 && quote !== 39) return from;

    let index = at + 1;
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (code === 92) {
        index += 2;
        continue;
      }
      if (code === quote || code === 10) break;
      index++;
    }
    if (source.charCodeAt(index) !== quote) return from;

    index++;
    while (index < source.length && (source.charCodeAt(index) === 32 || source.charCodeAt(index) === 9)) index++;
    if (source.charCodeAt(index) === 59 /* ; */) index++;
    if (source.charCodeAt(index) === 13) index++;
    if (source.charCodeAt(index) !== 10) return from;
    at = index + 1;
  }
}

function skipTrivia(source: string, from: number): number {
  let at = from;
  while (at < source.length) {
    const code = source.charCodeAt(at);
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 12) {
      at++;
      continue;
    }
    if (code === 47 && source.charCodeAt(at + 1) === 47) {
      at = nextLine(source, at);
      continue;
    }
    if (code === 47 && source.charCodeAt(at + 1) === 42) {
      const close = source.indexOf("*/", at + 2);
      at = close === -1 ? source.length : close + 2;
      continue;
    }
    break;
  }
  return at;
}

/** The start of the line after the one `from` is on, or the end of the source. */
function nextLine(source: string, from: number): number {
  const line = source.indexOf("\n", from);
  return line === -1 ? source.length : line + 1;
}
