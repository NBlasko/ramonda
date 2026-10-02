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

/**
 * What a hole in the wrong place says, wherever it is found.
 *
 * One sentence, one place: the build refuses these and the CSS checker reports them, and a fault that
 * read differently depending on which tool found it would be two faults to a reader.
 *
 * **The advice used to send an author into the next refusal.** It read *a custom property holds a
 * value, so write `property: {…}` and put the choice inside it* — written when a hole in a
 * declaration compiled to a custom property on the element. It does not any more: a runtime value in
 * a declaration is refused everywhere, so following that sentence moved somebody from
 * `hole-out-of-place` to `hole-not-allowed`. Measured, all three spellings in one run:
 *
 *     @@( {pick}; )              a hole cannot be a whole declaration   <- what they wrote
 *     @@( color: {pick}; )       hole-not-allowed                       <- what it told them
 *     @@( color: var({A}); )     clean                                  <- what works
 *
 * So it names the door that is open. A hole still stands in exactly one place — the NAME of a
 * `@@property( … )` from this file — which is the half of the old sentence that was true.
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
  throw new CssBlockError(message, filename, line, column);
}
