import { IS_LIST } from "../helpers/constants";
import type { ListNode, VNode, ComponentClassKind } from "../types/vdom";

/**
 * The array a list draws from.
 *
 * **Nullish is allowed and renders nothing**, which is the point: data that has
 * not arrived yet is `undefined`, and `this.query.data ?? []` would build a fresh
 * empty array on every render — a changed array, so the list drops its item
 * scopes and RMD020 reports it. Pass the value straight through.
 */
export type Each<T> = readonly T[] | null | undefined;

/**
 * Builds the vnode for one item.
 *
 * `index` is the item's CURRENT position: declare the parameter and a row that
 * moves is rebuilt, so the number it shows always matches where the row is. That
 * costs a mapper call per moved row, which is why declaring the parameter is what
 * asks for it — `(item) => …` skips untouched rows through a reorder, and is the
 * one to write when the position is not on screen.
 *
 * It is read from the parameter LIST, so a mapper that hides its arity —
 * `(item, index = 0)`, `(...args)` — opts out of the check and can show a stale
 * position after a reorder.
 */
export type ItemRender<T> = (item: T, index: number) => VNode;

/** A component that takes the item as its `item` prop. */
export type ItemComponent<T> = ComponentClassKind<{ item: T }>;

/**
 * A list, as a plain function call in an expression slot.
 *
 * ```tsx
 * <ul>
 *   {list(this.todo, TaskRow)}
 *   {this.open ? list(this.results, (r) => <li>{r.title}</li>) : null}
 * </ul>
 * ```
 *
 * ## Two arguments, and why there is no options bag
 *
 * There used to be one — `{ each, as, render, key }` — and every field but the
 * first has since stopped existing. `key` went when identity started being
 * carried on the item, so a refetch keeps its rows without one; `as` and `render`
 * were always mutually exclusive, and a bag whose fields exclude each other is a
 * shape that can be written wrong. Two positional arguments cannot: the items,
 * and the one way to turn an item into markup.
 *
 * The second argument is a COMPONENT or a FUNCTION, and nothing has to say which.
 * A class has a construct signature and no call signature, an arrow has the
 * reverse, so the two overloads below are mutually exclusive with no union and no
 * `never` fields. At runtime the class is recognised by `__isComponent`, checked
 * BEFORE the arity read that decides whether a mapper watches its index — a
 * constructor's parameter count means nothing here.
 *
 * `RMD014` went with the bag: "both given" and "neither given" are no longer
 * expressible, which is better than reporting them.
 *
 * ## It does not bend the one-tag-one-element rule
 *
 * A function in an expression slot is not a tag. It is what the framework already
 * tells people to do when they need vnodes from a function — see RMD011, which
 * points at `{rows()}` for exactly this reason. A `<For>` TAG would be the
 * violation, because a tag producing N siblings is a fragment with extra steps.
 *
 * ## What it returns
 *
 * A **descriptor**, not built vnodes: the mapper has not run yet when this
 * returns. `normalizeChildren` stamps the descriptor with its child position, and
 * the diff builds the items when it reconciles the region — which is the only
 * moment the previous region, and therefore the list's state, is in hand.
 *
 * That state (minted ids, per-item reactive scopes, the whole-list skip) lives on
 * the region's record entry, so it is per parent and per position for free, and
 * it is released when the region goes.
 *
 * ## Identity, and why there is nothing to write
 *
 * An object is identified by itself, a unique primitive by its value, and a
 * repeated primitive by which occurrence it is. Data replaced from OUTSIDE — a
 * refetch, a `JSON.parse` — is aligned against what is on screen and carries each
 * row's identity across, so a row that changed keeps its DOM node and its
 * component's state. See `itemIdentity`.
 *
 * ## What the hook did better, and what it cost
 *
 * Identity here is the ORIGIN plus the POSITION — which component's render built
 * the call, and which child slot it occupies. A hook instance survived being
 * moved among its siblings; this does not, so moving a `list()` call to a
 * different slot loses the per-item scope cache. Correctness is unaffected — item
 * identity is re-derived from the items themselves — so the cost is one full
 * re-render of that list, on a structural change that is rare.
 *
 * The origin half is not optional. With position alone, a component's own list
 * and a caller's list arriving through `{this.props.children}` both claimed slot
 * 0 of the same element and fought over one region. See `regionOwner`.
 */
export function list<T>(each: Each<T>, as: ItemComponent<T>): ListNode;
export function list<T>(each: Each<T>, render: ItemRender<T>): ListNode;
export function list<T>(each: Each<T>, builder: ItemComponent<T> | ItemRender<T>): ListNode {
  // `owner: undefined` is the signal that this is a descriptor rather than a
  // built list — `normalizeChildren` stamps the position, and the diff builds
  // the items.
  return {
    [IS_LIST]: true,
    owner: undefined,
    each,
    builder,
  } as unknown as ListNode;
}

export type { LazyListNode } from "../helpers/listEngine";
export { isLazyList } from "../helpers/listEngine";
