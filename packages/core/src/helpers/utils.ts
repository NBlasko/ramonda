export const isArray = Array.isArray;

/**
 * What to call a component or a hook instance in a diagnostic.
 *
 * `constructor?.name` was written out verbatim — the optional chain and the
 * `?? "Unknown"` included — in `hydration/serialize.ts`, `hydration/restore.ts`,
 * `hydration/lint.ts` and `helpers/watchProps.ts`: four byte-identical copies of one
 * expression, plus three more spellings in `base/decorators.ts`. That is not a
 * TypeScript problem; `unknown` only made it look like one.
 *
 * `base/Context.ts` keeps its own and should: it needs `undefined` when the holder is
 * not known, because RMD003's message branches on that, and "Unknown" would change
 * what it prints.
 *
 * Both halves of the fallback are real: a `Object.create(null)` instance has no
 * `constructor`, and a class expression assigned to nothing has a `constructor`
 * whose `name` is the empty string — which is why the `??` cannot become a `||`
 * without changing "" into "Unknown".
 */
export function displayName(value: unknown): string {
  return (value as { constructor?: { name?: string } } | null | undefined)?.constructor?.name ?? "Unknown";
}
