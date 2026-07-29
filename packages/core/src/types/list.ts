import type { VNode, ComponentClassKind } from "./vdom";

interface ListBase<T> {
  /**
   * The list. Read reactively: the owner re-renders when it is replaced.
   *
   * **Nullish is allowed and renders nothing**, which is the point: data that has not
   * arrived yet is `undefined`, and `each: this.query.data ?? []` would build a fresh
   * empty array on every render — a changed `each`, so the list drops its item scopes and
   * RMD020 reports it. Pass the value straight through.
   */
  each: readonly T[] | null | undefined;
  /**
   * Only for items that are re-created as fresh objects but mean the same
   * entity — a refetch, a deserialize. Then identity has to come from a field:
   * `key: (item) => item.id`. Do not reach for this otherwise; the whole point
   * is that you do not write identity by hand.
   */
  key?: (item: T) => string | number;
}

/**
 * `as` — the item-to-component shorthand, and the way to render a list with NO
 * per-item function of your own. Give a component that takes the item as its
 * `item` prop; it builds `<Component item={item} />` for each one.
 *
 * There is no `render: (item) => …` closure to write, so nothing to memoize and
 * nothing for a "recreated inline function" check to flag. Reach for `render`
 * only when an item maps to plain markup rather than a component.
 */
interface ListAs<T> extends ListBase<T> {
  as: ComponentClassKind<{ item: T }>;
  render?: never;
}

interface ListRender<T> extends ListBase<T> {
  /** Builds the vnode for one item. Prefer `as` when the item maps to a component. */
  render: (item: T, index: number) => VNode;
  as?: never;
}

/** What `list()` takes: the items, and exactly one way to turn one into markup. */
export type ListOptions<T> = ListAs<T> | ListRender<T>;
