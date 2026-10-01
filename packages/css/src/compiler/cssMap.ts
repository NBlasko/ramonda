import type { Origin, SourceMap } from "./transform";

/**
 * A source map for a generated stylesheet: each position found in it points at where the author
 * wrote that rule. One source, the author's file; the columns and lines are zero-based, as the source
 * map specification counts them.
 */
export function sourceMapFor(
  css: string,
  found: readonly { readonly at: number; readonly origin: Origin }[],
  file: string,
  content?: string,
): SourceMap {
  const sorted = [...found].sort((a, b) => a.at - b.at);
  const lines: string[] = [];
  let line = 0;
  let lineStart = 0;
  let segments: string[] = [];
  let previousColumn = 0;
  let previousLine = 0;
  let previousSourceColumn = 0;
  let index = 0;
  for (let at = 0; at <= css.length; at++) {
    while (index < sorted.length && (sorted[index] as { at: number }).at === at) {
      const { origin } = sorted[index] as { origin: Origin };
      const column = at - lineStart;
      segments.push(
        vlq(column - previousColumn) +
          vlq(0) +
          vlq(origin.line - previousLine) +
          vlq(origin.column - previousSourceColumn),
      );
      previousColumn = column;
      previousLine = origin.line;
      previousSourceColumn = origin.column;
      index++;
    }
    if (at === css.length || css[at] === "\n") {
      lines[line] = segments.join(",");
      segments = [];
      previousColumn = 0;
      line++;
      lineStart = at + 1;
    }
  }
  return {
    version: 3,
    sources: [file],
    ...(content === undefined ? {} : { sourcesContent: [content] }),
    names: [],
    mappings: lines.join(";"),
  };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** One number as a Base64 VLQ, the encoding every source map uses. */
function vlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    out += BASE64[digit];
  } while (rest > 0);
  return out;
}
