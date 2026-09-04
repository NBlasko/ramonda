/**
 * A block this cannot compile, said where it is.
 *
 * There is no recovery and there should not be one. A hole in a position a custom property cannot
 * occupy has no correct compilation — emitting *something* would mean guessing, and the guess would
 * be a style that silently does not apply. The checker (track D) reports the same faults earlier and
 * without stopping a build; this is the last line, and it stops.
 */
export class CssBlockError extends Error {
  readonly filename: string;
  /** 1-based, the way an editor counts. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;

  constructor(message: string, filename: string, line: number, column: number) {
    super(`${filename}:${line}:${column}  ${message}`);
    this.name = "CssBlockError";
    this.filename = filename;
    this.line = line;
    this.column = column;
  }
}

/** The 1-based line and column of an offset, counted the way an editor does. */
export function positionOf(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset && index < source.length; index++) {
    if (source.charCodeAt(index) === 10) {
      line++;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

export function refuse(message: string, source: string, offset: number, filename: string): never {
  const { line, column } = positionOf(source, offset);
  throw new CssBlockError(message, filename, line, column);
}
