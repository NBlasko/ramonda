/**
 * Positions coming back from the virtual file. Every answer the language service gives is about the
 * virtual text, so a span is moved into the author's coordinates here — or dropped, when it names text
 * the author never wrote.
 *
 * Part of the editor plugin — see `../plugin.ts`, which wires these into the language service.
 */
import { type Span } from "../../compiler/read";
import { type VirtualFile } from "../../compiler/virtual";
import type ts from "typescript";

/** True when the position belongs to the CSS itself — inside a block, outside every hole. */
export function isCss({ blocks, holes }: { blocks: readonly Span[]; holes: readonly Span[] }, at: number): boolean {
  const inBlock = blocks.some((span) => span.start <= at && at < span.end);
  return inBlock && !holes.some((span) => span.start <= at && at < span.end);
}

/** A span in virtual coordinates, in the author's — or nothing, when it names text they never wrote. */
export function back(file: VirtualFile, span: ts.TextSpan | undefined): ts.TextSpan | undefined {
  return span === undefined ? undefined : file.spanOf(span.start, span.length);
}

/**
 * An outline item and its children, moved home, with this package's own scaffolding left out.
 *
 * The scaffolding is not a detail here: the virtual file declares `__block`, and an outline listing
 * it beside the author's own names is a lie about what the file contains. An item whose span maps
 * nowhere is exactly that item, so dropping the unmappable is the whole filter.
 */
export function tree(file: VirtualFile, item: ts.NavigationTree): ts.NavigationTree {
  return {
    ...item,
    spans: spansHome(file, item.spans),
    nameSpan: item.nameSpan === undefined ? undefined : back(file, item.nameSpan),
    childItems: item.childItems?.flatMap((child) => {
      const moved = tree(file, child);
      return moved.spans.length === 0 ? [] : [moved];
    }),
  };
}

/** The flat outline, the same way. */
export function bar(file: VirtualFile, items: readonly ts.NavigationBarItem[]): ts.NavigationBarItem[] {
  return items.flatMap((item) => {
    const spans = spansHome(file, item.spans);
    return spans.length === 0 ? [] : [{ ...item, spans, childItems: bar(file, item.childItems ?? []) }];
  });
}

/** Spans that survive the move; the ones that do not were never the author's. */
export function spansHome(file: VirtualFile, spans: readonly ts.TextSpan[]): ts.TextSpan[] {
  return spans.flatMap((span) => {
    const moved = back(file, span);
    return moved === undefined ? [] : [moved];
  });
}

/**
 * Entries that may live in any file, each moved home out of ITS OWN file's coordinates.
 *
 * Not just the file that was asked about: the host is patched program-wide, so EVERY file the
 * program sees is virtual — a definition in a second styled file comes back in that file's virtual
 * coordinates, past the end of the author's text by the length of the preamble. Reached by
 * go-to-definition, go-to-type-definition, go-to-implementation, find-references,
 * definition-and-bound-span and document highlights.
 *
 * Each entry's own file is looked up in the overlay cache rather than compared to the file asked
 * about, so a path spelled differently simply builds that file's overlay under the other spelling,
 * which maps correctly either way. A file with no block has no overlay and is returned untouched.
 */
export function elsewhere<T extends { fileName: string; textSpan: ts.TextSpan; contextSpan?: ts.TextSpan }>(
  overlayOf: (fileName: string) => VirtualFile | undefined,
  entries: readonly T[],
): T[] {
  return entries.flatMap((entry) => {
    const file = overlayOf(entry.fileName);
    if (file === undefined) return [entry];

    const textSpan = back(file, entry.textSpan);
    if (textSpan === undefined) return [];
    return [{ ...entry, textSpan, contextSpan: back(file, entry.contextSpan) }];
  });
}

/**
 * Encoded classification triples — `[start, length, kind]` — moved back to the author's file.
 *
 * A triple that maps nowhere is the scaffolding's own and is dropped rather than guessed at: a
 * colour on `__block` would be a colour on a character the author never wrote. What survives is cut
 * to the range the editor asked about, which is usually the part of the file it can see.
 */
export function home(
  file: VirtualFile,
  spans: readonly number[],
  asked: ts.TextSpan,
  where: { blocks: readonly Span[]; holes: readonly Span[] },
): number[] {
  const out: number[] = [];
  for (let i = 0; i + 2 < spans.length; i += 3) {
    const span = file.spanOf(spans[i], spans[i + 1]);
    if (span === undefined) continue;
    if (span.start + span.length <= asked.start || span.start >= asked.start + asked.length) continue;
    /**
     * Inside a block the grammar is the authority, and TypeScript's opinion is not redundant but
     * wrong. Measured in a real editor: `display` came out white and `flex-direction` blue in the
     * same block, because one is a bare key in the virtual file and gets a token while the other has
     * to be quoted and gets none. A CSS property painted as a TypeScript property, at random.
     */
    if (isCss(where, span.start)) continue;
    out.push(span.start, span.length, spans[i + 2]);
  }
  return out;
}

/**
 * Diagnostics whose positions are the author's, with the scaffolding's own dropped.
 *
 * A diagnostic about `__block` is about the file this wrote. The preamble is the exception the check
 * command makes — a block shape that cannot be resolved means nothing is checked — and it is
 * deliberately NOT made here: an editor shows a project-wide setup fault on every file it opens, and
 * `ramonda-css` is the place that says it once.
 */
export function mapped<T extends ts.Diagnostic>(file: VirtualFile, diagnostics: readonly T[]): T[] {
  const out: T[] = [];
  for (const diagnostic of diagnostics) {
    /**
     * `start` is optional on the type and always present here: both callers ask about ONE file, and
     * a diagnostic about a file has a position in it. A project-wide one — an option the compiler
     * rejects — comes from `getCompilerOptionsDiagnostics`, which this does not touch.
     */
    const span = back(file, { start: diagnostic.start ?? 0, length: diagnostic.length ?? 0 });
    if (span === undefined) continue;
    out.push({ ...diagnostic, start: span.start, length: span.length });
  }
  return out;
}
