/**
 * Whether a value holds a `var()`, which no split may touch — see `splitPositional` in
 * `compiler/split.ts`.
 *
 * ONE test for every place that asks. There were two, and they disagreed: the positional splitter
 * matched the lower-case spelling only, and CSS function names are case-insensitive, so
 * `padding: VAR(--p)` was split and every longhand came out invalid.
 *
 * **And everything else a page substitutes**, which is the same unknown: a custom function
 * (`--pad()`) returns whatever tokens its `@function` says, and `attr()` whatever the attribute holds
 * — `1px 2px` on one longhand is two values, invalid, and dropped. A review found `--pad()` copied
 * onto all four sides; an earlier version of this note had excluded it on purpose, wrongly.
 *
 * Its own module because both halves ask it: the compiler, and the merge's development warning, which
 * ships to a browser and must not pull the splitter's tables in with it.
 */
export function holdsVar(value: string): boolean {
  return /(^|[^\w-])(var|attr)\(|(^|[^\w-])--[\w-]+\(/i.test(value);
}
