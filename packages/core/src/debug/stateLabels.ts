/**
 * DEV-only names for signals, kept outside the State instance on purpose.
 *
 * State is the hottest object in the framework and an app holds thousands of
 * them. A declared class field costs a slot on every instance even when nothing
 * ever assigns it — `private metaData: string | undefined` emits `metaData;`,
 * which defines the property as undefined on construction. Debug data must not
 * be paid for in production, so it lives here instead and the whole module drops
 * out of the bundle once the `if (__DEV__)` call sites are stripped.
 */

interface StateLabel {
  property: string;
  owner?: string;
}

const labels = new WeakMap<object, StateLabel>();

export function labelState(signal: object, property: string, owner: string | undefined): void {
  labels.set(signal, { property, owner });
}

/** The property name alone, e.g. "items". */
export function stateProperty(signal: object): string | undefined {
  return labels.get(signal)?.property;
}

/** Qualified where possible, e.g. "TodoList.items". */
export function stateLabel(signal: object): string | undefined {
  const label = labels.get(signal);
  if (!label) return undefined;
  return label.owner ? `${label.owner}.${label.property}` : label.property;
}
