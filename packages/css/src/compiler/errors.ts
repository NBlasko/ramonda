/**
 * A block this cannot compile, said where it is.
 *
 * There is no recovery and there should not be one. A hole in a position a custom property cannot
 * occupy has no correct compilation — emitting *something* would mean guessing, and the guess would
 * be a style that silently does not apply. The checker reports the same faults earlier and without
 * stopping a build; this is the last line, and it stops.
 */
export class CssBlockError extends Error {
  readonly filename: string;
  /** 1-based, the way an editor counts. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
  /** The offset in the source, and the sentence without its position — what an editor shows. */
  readonly offset?: number;
  readonly reason?: string;

  constructor(message: string, filename: string, line: number, column: number, offset?: number) {
    super(`${filename}:${line}:${column}  ${message}`);
    this.name = "CssBlockError";
    this.filename = filename;
    this.line = line;
    this.column = column;
    this.offset = offset;
    this.reason = message;
  }
}

/**
 * What a hole in the wrong place says, wherever it is found.
 *
 * One sentence, one place: the build refuses these and the CSS checker reports them, and a fault
 * that read differently depending on which tool found it would be two faults to a reader.
 *
 * **It names the door that is open.** A runtime value in a declaration is refused everywhere, so
 * advice to write `property: {…}` would only move the author from `hole-out-of-place` to
 * `hole-not-allowed`. A hole stands in exactly one place — the NAME of a `@@property( … )` from
 * this file — and reading one is `var({A})`.
 */
export function holeOutOfPlace(what: "a declaration" | "a property name" | "a selector" | "a frame"): string {
  const door =
    " A value that comes from data is declared with `@@property( … )` and read as `var($(name))`; one" +
    " that is a choice between a few is written out with `match`.";
  return what === "a declaration"
    ? `a hole cannot be a whole declaration — a declaration needs a property, and a block takes no runtime value in one.${door}`
    : `a hole cannot stand in ${what} — ${what} is text when the stylesheet is written, and a hole is not.` +
        (what === "a property name"
          ? " The one exception is a `@@property( … )` declared in this file, whose name only this compiler knows."
          : "");
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
  throw new CssBlockError(message, filename, line, column, offset);
}
