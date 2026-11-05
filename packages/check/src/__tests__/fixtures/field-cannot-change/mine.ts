/** An app's own function that happens to share the name. */
export function htmlConstraints(_schema: unknown): (path: string) => Record<string, unknown> {
  return () => ({});
}
