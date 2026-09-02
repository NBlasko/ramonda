/**
 * Enough of `@ramonda/lens` for `needs` to be satisfied and for `focusOn` to resolve.
 *
 * The chain is typed loosely on purpose: this rule reads the path from DECLARATIONS, not from what
 * the chain's own types say, so a faithful `Focus<T>` would test the stub rather than the rule.
 */
export interface Chain {
  get(key: string | number): Chain;
  at(index: number): Chain;
  where(predicate: (value: never) => boolean): Chain;
  set(value: unknown): unknown;
  merge(value: unknown): unknown;
  update(updater: (value: never) => unknown): unknown;
  value(): unknown;
}

export function focusOn(root: unknown): Chain {
  void root;
  return undefined as unknown as Chain;
}
