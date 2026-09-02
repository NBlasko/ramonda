/**
 * An app's OWN `focusOn`, exported under the very name the lens uses.
 *
 * The shape the rule has to tell apart, and the reason it goes by the package a binding came from
 * rather than by the written name. Judging this one by the lens's semantics would report somebody
 * else's function for somebody else's rules.
 */
export function focusOn(root: unknown): { get(key: string): { get(key: string): { set(value: unknown): void } } } {
  void root;
  return undefined as never;
}
