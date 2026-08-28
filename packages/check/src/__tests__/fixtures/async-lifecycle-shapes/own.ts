/** An app's OWN decorator, which happens to be called `created`. Nobody else's business. */
export function created(): (target: unknown, context: unknown) => void {
  return () => {};
}
