import { IS_LIST } from "../helpers/constants";
import type { ListNode } from "../types/vdom";
import type { ListOptions } from "../types/list";

/**
 * A list, as a plain function call in an expression slot.
 *
 * ```tsx
 * <ul>
 *   {list({ each: this.todo, as: TaskRow })}
 *   {this.open ? list({ each: this.results, render: (r) => <li>{r.title}</li> }) : null}
 * </ul>
 * ```
 *
 * ## It replaced a hook, and why
 *
 * Lists used to be `this.use(For, …)`. A hook has to be constructed, so a
 * component with a list it may never show still built one, its options callback
 * was re-evaluated on every render, and the declaration sat nowhere near the
 * branch deciding whether the list existed. Several lists meant several
 * declarations, each carrying its markup far from `render()`.
 *
 * `list()` has none of that. Nothing is declared, nothing runs unless the call
 * is reached, and the options sit where the list does.
 *
 * ## It does not bend the one-tag-one-element rule
 *
 * A function in an expression slot is not a tag. It is what the framework
 * already tells people to do when they need vnodes from a function — see RMD011,
 * which points at `{rows()}` for exactly this reason. A `<For>` TAG would be the
 * violation, because a tag producing N siblings is a fragment with extra steps.
 *
 * ## What it returns
 *
 * A **descriptor**, not built vnodes: the mapper has not run yet when this
 * returns. `normalizeChildren` stamps the descriptor with its child position,
 * and the diff builds the items when it reconciles the region — which is the
 * only moment the previous region, and therefore the list's state, is in hand.
 *
 * That state (minted ids, per-item reactive scopes, the whole-list skip) lives
 * on the region's record entry, so it is per parent and per position for free,
 * and it is released when the region goes.
 *
 * ## What the hook did better, and what it cost
 *
 * Identity here is the ORIGIN plus the POSITION — which component's render built
 * the call, and which child slot it occupies. A hook instance survived being
 * moved among its siblings; this does not, so moving a `list()` call to a
 * different slot loses the per-item scope cache. Correctness is unaffected —
 * item identity is re-derived from the items themselves — so the cost is one
 * full re-render of that list, on a structural change that is rare.
 *
 * The origin half is not optional. With position alone, a component's own list
 * and a caller's list arriving through `{this.props.children}` both claimed
 * slot 0 of the same element and fought over one region. See `regionOwner`.
 */
export function list<T>(options: ListOptions<T>): ListNode {
  // `owner: undefined` is the signal that this is a descriptor rather than a
  // built list — `normalizeChildren` stamps the position, and the diff builds
  // the items.
  return {
    [IS_LIST]: true,
    owner: undefined,
    options,
  } as unknown as ListNode;
}

export type { LazyListNode } from "../helpers/listEngine";
export { isLazyList } from "../helpers/listEngine";
