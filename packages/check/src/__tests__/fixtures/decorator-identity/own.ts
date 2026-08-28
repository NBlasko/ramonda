/** An app's OWN decorator called `persist`. Nobody else's business. */
export function persist(target: unknown, context: unknown): void {
  void target;
  void context;
}
