/**
 * `$.color.primary.main` — one path, three spellings, and one function for each so they cannot drift.
 *
 * A path is written in a block, becomes a custom property in the stylesheet, and becomes a
 * TypeScript member expression in the virtual file. Codegen writes the first spelling, the compiler
 * writes the second, the virtual file writes the third — three callers, so each answer lives here
 * rather than being spelled out wherever it is needed.
 *
 * ## Why the compiler needs no config to do this
 *
 * `$` compiles to a plain `var(--name)`, with no fallback, and that is measured rather than assumed.
 * A variable registered with `@property { initial-value }` resolves even when nothing anywhere sets
 * it, so the guarantee belongs in the stylesheet codegen writes — once — rather than in every use:
 *
 *     registered, set by nothing at all   `height: var(--x)`   ->  "30px"
 *     unregistered, set by nothing        `height: var(--x)`   ->  "0px"   and silently
 *
 * So the CLI, the bundler and the editor cannot disagree about what a `$` compiles to: none of them
 * reads anything to do it. What does need the project's declarations is the CHECKER, which is where
 * a path naming nothing is reported, and codegen, which writes the names in the first place.
 */

/**
 * The custom property a path names — `color.primary.main` to `--color-primary-main`.
 *
 * Levels are joined with a dash, which is the one thing that makes two paths able to meet:
 * `a-b.c` and `a.b-c` both arrive here as `--a-b-c`. That collision is caught where the names are
 * MADE, in codegen, which is the only place that can see both paths at once.
 */
export function nameFor(path: string): `--${string}` {
  return `--${path.split(".").join("-")}`;
}

/** Whether a segment can be written after a dot in TypeScript, or needs brackets. */
export function isIdentifier(segment: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment);
}

/**
 * The path as a TypeScript expression, for the virtual file — `$.space.inline["2xl"]`.
 *
 * **The two spellings differ on purpose, and only here.** `2xl` and `0` are ordinary names in a
 * design system, and the block is this package's grammar, so `$.space.inline.2xl` is writable there.
 * Only the virtual file has to BE TypeScript, and measured, the dotted form does not parse —
 * `TS1351: An identifier or keyword cannot immediately follow a numeric literal` — while the
 * bracketed form does.
 *
 * An empty path is the root alone, which is what a half-typed `$.` in an editor needs: the
 * expression has to be something the language service can offer members on.
 *
 * `root` is the NAME the virtual file declared for it, which is not `$` — see `virtual.ts`. A block
 * is this package's language, so `$` inside one needs no import; the virtual file binds it under a
 * name of its own so an author who also uses `$` for something else is not disturbed.
 */
export function expressionFor(path: string, root = "$", open = false): string {
  const written = path
    .split(".")
    .filter((segment) => segment !== "")
    .reduce(
      (so_far, segment) => (isIdentifier(segment) ? `${so_far}.${segment}` : `${so_far}[${JSON.stringify(segment)}]`),
      root,
    );

  /**
   * A trailing dot is kept, because it is what an editor is asked about.
   *
   * `$.color.` emitted as `__vars.color` is a finished expression, and the language service answers
   * a finished expression with nothing. With the dot it is a member access in progress and the
   * members are offered — which is the whole point of the spelling. Measured both ways.
   */
  return open ? `${written}.` : written;
}
