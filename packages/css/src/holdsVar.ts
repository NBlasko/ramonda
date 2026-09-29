/**
 * Whether a value holds a `var()`, which no split may touch — see `splitPositional` in
 * `compiler/split.ts`.
 *
 * ONE test for every place that asks. There were two, and they disagreed: the positional splitter
 * matched the lower-case spelling only, and CSS function names are case-insensitive, so
 * `padding: VAR(--p)` was split and every longhand came out invalid. The `-` before the name is
 * excluded because `--my-var(` is a custom function, not a `var()`.
 *
 * Its own module because both halves ask it: the compiler, and the merge's development warning, which
 * ships to a browser and must not pull the splitter's tables in with it.
 */
export function holdsVar(value: string): boolean {
  return /(^|[^\w-])var\(/i.test(value);
}
