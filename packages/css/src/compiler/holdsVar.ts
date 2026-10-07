/**
 * Whether a value holds a `var()`, which no split may touch — see `splitPositional` in
 * `compiler/split.ts`.
 *
 * ONE test for every place that asks, and case-insensitive because CSS function names are: a test
 * for the lower-case spelling alone would split `padding: VAR(--p)` into longhands that are all
 * invalid.
 *
 * **And everything else a page substitutes**, which is the same unknown: a custom function
 * (`--pad()`) returns whatever tokens its `@function` says, and `attr()` whatever the attribute
 * holds — `1px 2px` on one longhand is two values, invalid, and dropped.
 *
 * Its own module because both halves ask it: the compiler, and the merge's development warning,
 * which ships to a browser and must not pull the splitter's tables in with it.
 */
export function holdsVar(value: string): boolean {
  return /(^|[^\w-])(var|attr)\(|(^|[^\w-])--[\w-]+\(/i.test(value);
}
