/**
 * Turns a position in the file the ENGINE ran into a position in the file you wrote.
 *
 * ## Why this is not optional
 *
 * A component's location comes off a stack, and a stack reports the transformed module —
 * `Error.stack` is never sourcemapped (a browser applies sourcemaps when it DISPLAYS a stack in its
 * own devtools, never in the string). The obvious hope is that a dev server's transform keeps lines
 * aligned. Measured against Vite 7 serving a real playground page, it does not:
 *
 * ```
 *   source   line 20:  export class DiagnosticsPage extends Component {
 *   served   line 51:  export class DiagnosticsPage extends (_a = Component, _fired_dec = [state], …
 * ```
 *
 * Thirty-one lines out, because esbuild lowers standard decorators and prepends a preamble. Landing
 * thirty lines from the class is not "close enough" — it is a button that looks broken. So the
 * position is resolved properly.
 *
 * ## How, without a plugin or a dependency
 *
 * Vite serves each module with an INLINE sourcemap, so the map is already in the file the browser
 * has cached. Fetch the module, read the `sourceMappingURL` data URL, decode the mappings, and look
 * up the segment for that generated position. Same measurement, resolved:
 *
 * ```
 *   generated 51:0  →  original 20:8    ← the class declaration, exactly
 * ```
 *
 * It runs once, on a click, so nothing here needs to be fast.
 *
 * Everything fails towards the unresolved position: no map, an unfetchable module, a map without a
 * segment for that line — the raw numbers still open the right FILE, which is most of the value.
 */

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export interface Position {
  line: number;
  column: number;
  /**
   * The file the map says the code came from, exactly as the map wrote it — which for a bundle is
   * relative to the bundle's place on disk, not to any URL. Absent means the map said nothing.
   */
  source?: string;
  /** The module the map came from, so whoever resolves `source` knows what it is relative to. */
  from?: string;
}

/** What the mappings themselves carry: a position, and WHICH of the map's sources it is in. */
export interface MappedPosition {
  line: number;
  column: number;
  sourceIndex: number;
}

/** Base64 VLQ: five bits of payload per character, bit six as the continuation flag, sign in bit 1. */
function decodeSegment(segment: string): number[] {
  const values: number[] = [];
  let shift = 0;
  let value = 0;

  for (const character of segment) {
    const digit = BASE64.indexOf(character);
    if (digit === -1) return values;

    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }

    const negative = value & 1;
    value >>= 1;
    values.push(negative ? -value : value);
    shift = 0;
    value = 0;
  }
  return values;
}

/**
 * The original position for a generated one, or `undefined` when the map has nothing for that line.
 *
 * Both inputs and the result are 1-based, as an editor and a stack frame both are; a sourcemap is
 * 0-based for lines and columns, which is the one conversion in here.
 *
 * The segments of a line are walked in order because their fields are DELTAS — against the previous
 * segment for the column, and against the previous *mapped* segment anywhere in the map for the
 * source position. That is why the outer loop cannot skip to the target line.
 */
export function mapPosition(mappings: string, line: number, column: number): MappedPosition | undefined {
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;

  const lines = mappings.split(";");
  for (let generatedLine = 0; generatedLine < lines.length; generatedLine++) {
    let generatedColumn = 0;
    let best: MappedPosition | undefined;

    for (const segment of lines[generatedLine].split(",")) {
      if (segment === "") continue;

      const fields = decodeSegment(segment);
      generatedColumn += fields[0] ?? 0;
      if (fields.length >= 4) {
        sourceIndex += fields[1];
        sourceLine += fields[2];
        sourceColumn += fields[3];
      }

      // The last segment at or before the column asked for: a generated line holds several, and the
      // nearest one to the left is the one that describes the code at that position.
      if (generatedLine + 1 === line && fields.length >= 4 && generatedColumn <= column) {
        best = { line: sourceLine + 1, column: sourceColumn + 1, sourceIndex };
      }
    }

    if (generatedLine + 1 === line) return best;
  }
  return undefined;
}

/** The inline map a dev server appends, or `undefined` when the module carries none. */
export function inlineMap(code: string): { mappings: string; sources: string[] } | undefined {
  const marker = /sourceMappingURL=data:application\/json;(?:charset=[^;]+;)?base64,([A-Za-z0-9+/=]+)/.exec(code);
  if (!marker) return undefined;

  try {
    const parsed = JSON.parse(atob(marker[1])) as { mappings?: string; sources?: unknown };
    if (typeof parsed.mappings !== "string") return undefined;
    const sources = Array.isArray(parsed.sources) ? parsed.sources.map(String) : [];
    return { mappings: parsed.mappings, sources };
  } catch {
    return undefined;
  }
}

/**
 * Resolves a stack position against the module's own inline map.
 *
 * Fetches the exact URL the stack reported, cache-busting query and all — that is the module the
 * engine ran, and any other version of it would be a different set of line numbers.
 */
export async function resolveOriginal(file: string, line: number, column: number): Promise<Position> {
  const unresolved = { line, column };
  if (!/^[a-z]+:\/\//i.test(file)) return unresolved;

  try {
    const response = await fetch(file);
    if (!response.ok) return unresolved;

    const map = inlineMap(await response.text());
    if (!map) return unresolved;

    const found = mapPosition(map.mappings, line, column);
    if (!found) return unresolved;

    /**
     * The FILE comes from the map too, not from the module URL.
     *
     * For a dev server serving one module per file the two agree, so taking it from the map costs
     * nothing. For a bundled development build they do not: the module URL is the bundle, while the
     * map knows the source it came from — without this the line would be resolved correctly and
     * pointed at the wrong file, which is worse than not resolving, because it looks right.
     */
    const name = map.sources[found.sourceIndex];

    /**
     * The source is kept EXACTLY as the map wrote it — `../../../../packages/router/src/Link.tsx` —
     * and not resolved here.
     *
     * Resolving it in the browser was the bug: `new URL("../../../../x", origin + "/assets/client.js")`
     * clamps at the origin root and yields `/packages/router/src/Link.tsx`, which the server then
     * resolved against its own root and did not find. The `..` chain is relative to the bundle's place
     * ON DISK, and only the server knows where that is — so it travels intact, with the module it
     * belongs to, and the server does the arithmetic.
     */
    return { line: found.line, column: found.column, source: name, from: file };
  } catch {
    return unresolved;
  }
}
