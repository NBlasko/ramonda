/**
 * Where a file's blocks, holes, values, `$` paths and preludes run, in the author's coordinates —
 * what decides, for any position, whether CSS or TypeScript answers it.
 *
 * Part of the editor plugin — see `../plugin.ts`, which wires these into the language service.
 */
import { type BlockItem, childrenOf } from "../../compiler/ast";
import { type Imported, namedSites } from "../../compiler/references";
import { MATCH, type Span, readBlock } from "../../compiler/read";
import { findBlocks } from "../../compiler/scan";

/**
 * Where a block runs in the author's file, and where its holes run inside it.
 *
 * Both are needed to answer one question — is this position the grammar's or TypeScript's? — and
 * the hole is why the block's own range is not enough: a hole IS TypeScript, and `this.weight`
 * inside one has to read the way it reads anywhere else.
 */
export function regions(text: string, fileName: string, readModule: Imported["read"]): Regions {
  const blocks: Span[] = [];
  const holes: Span[] = [];
  const values: ValueSpan[] = [];
  const paths: Span[] = [];
  const preludes: PreludeSpan[] = [];
  // A resolved reference is not a hole, so it is not a region TypeScript owns — an editor must not
  // colour `{slide}` as an expression in a place the build writes a name into. Imports included:
  // a token from another module is resolved here exactly as the build resolves it.
  const references = namedSites(text, { filename: fileName, read: readModule });
  for (const site of findBlocks(text)) {
    const read = readBlock(text, site.open, "", { tolerant: true, resolve: (name) => references.get(name) });
    blocks.push({ start: site.open, end: read.end });
    holes.push(...read.holes);
    collect(read.block.items, values, preludes, paths);
  }
  return { blocks, holes, values, paths, preludes };
}

/** Every declaration's VALUE, with the property it belongs to — see `valueWords`. */
export function collect(items: readonly BlockItem[], out: ValueSpan[], preludes?: PreludeSpan[], paths?: Span[]): void {
  for (const item of items) {
    if (item.kind === "match") {
      // The word itself, so a hover on it says what a match does — see `spoken`.
      if (item.at !== undefined) preludes?.push({ start: item.at, end: item.at + MATCH.length, prelude: MATCH });
      collect(childrenOf(item), out, preludes, paths);
      continue;
    }
    if (item.kind === "rule") {
      // The prelude's own span, which a nested rule already carries for the checker's squiggles.
      if (item.at !== undefined && item.preludeEnd !== undefined) {
        preludes?.push({ start: item.at, end: item.preludeEnd, prelude: item.prelude });
      }
      collect(item.items, out, preludes, paths);
      continue;
    }
    // A spread has no value and its own marker is what a reader hovers — see `spoken`.
    if (item.property.startsWith("...") && item.at !== undefined) {
      preludes?.push({ start: item.at, end: item.at + 3, prelude: "..." });
    }
    if (item.at === undefined || item.end === undefined) continue;
    /**
     * From the end of the property NAME rather than from `valueAt`, which skips to the first
     * character the author has typed. With nothing typed yet there is nothing to skip to — measured,
     * `overflow: ` put `valueAt` one PAST the caret, so the state you are in first was the one state
     * this could not answer.
     */
    out.push({ start: item.at + item.property.length, end: item.end, property: item.property });

    /**
     * A `$` path is TypeScript's to complete, exactly as a hole is.
     *
     * Without this, a caret inside `$.` was answered with the PROPERTY's own value words — measured,
     * `color: $.` offered 210 colour keywords where the variable groups belong, because the caret is
     * in a value and that is all this knew about it.
     */
    for (const part of item.value) {
      if (part.kind === "match" && part.at !== undefined) {
        preludes?.push({ start: part.at, end: part.at + MATCH.length, prelude: MATCH });
      }
      if (part.kind === "variable" && part.at !== undefined) {
        paths?.push({ start: part.at, end: part.at + (part.length ?? 0) });
      }
    }
  }
}

/** Nothing at all, for a file whose regions are not cached. */
export const EMPTY_REGIONS: Regions = { blocks: [], holes: [], values: [], paths: [], preludes: [] };

/** A declaration's value, and the property it sets. */
export interface ValueSpan {
  readonly start: number;
  readonly end: number;
  readonly property: string;
}

/** What one file's text is made of, as far as this plugin has to care. */
/** A nested rule's prelude, in the author's coordinates, with the text it holds. */
export interface PreludeSpan {
  readonly start: number;
  readonly end: number;
  readonly prelude: string;
}

export interface Regions {
  readonly blocks: readonly Span[];
  readonly holes: readonly Span[];
  readonly values: readonly ValueSpan[];
  /**
   * Where each `$` path runs — a region TypeScript owns, for the same reason a hole is.
   *
   * It IS a TypeScript expression, so the members of the project's variables are the only useful
   * answer there. Measured without it: `color: $.` offered 210 colour keywords.
   */
  readonly paths: readonly Span[];
  /** Where each nested rule's prelude runs — a selector, an at-rule, or a condition. */
  readonly preludes: readonly PreludeSpan[];
}
