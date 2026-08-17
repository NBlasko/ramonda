import { IS_LIST, COMPONENT_TYPE, TEXT_TYPE } from "../helpers/constants";
import type { ListNode, VNode } from "../types/vdom";

/**
 * The two questions the vdom asks about a value it did not build itself, in one
 * place — because a JSX child arrives as `unknown` and there is no `typeof` that
 * can tell a vnode from a list from a hole.
 *
 * ## Why these are predicates and not `boolean`
 *
 * A helper returning `boolean` answers the question and narrows nothing, so
 * every caller casts on the very next line anyway — which is how the same probe
 * came to be written seven ways. `isListLike` in `h.ts` and `isVNode` in
 * `debug/renderStability.ts` were both that shape, and both had an ad-hoc
 * `as { … }` sitting under them. Written as `value is ListNode` the cast has
 * nowhere left to be.
 *
 * ## Why the file is a leaf
 *
 * `isListNode` used to live in `core/DiffAndMerge.ts`, which cannot be the home:
 * `DiffAndMerge` imports `generateRenderOutput`, so the half of the callers that
 * sit under it could never have imported it back. This imports the symbol and
 * the types and nothing else, so every caller can reach it.
 *
 * Measured before moving, 1000 children x 20000 passes over a realistic mix:
 * the call is 0.80x-0.91x the inline probe across five rounds — under half a
 * nanosecond per probe, and if anything in the guard's favour. There is no
 * runtime argument for spelling it out by hand.
 */

/**
 * Carries `IS_LIST` — stamped by `list()`, by `h` and by `buildLazyList`, and by nothing else.
 *
 * **It says `value is ListNode`, and that is one step wider than the marker proves.** A `list()`
 * DESCRIPTOR carries the same marker with a `builder` and no `vnodes` yet, so it satisfies this and
 * is not a `ListNode`. The narrowing is still the right one for the callers — every one of them
 * asks "is this one child rather than markup?", which both shapes answer the same way — but it
 * means `vnodes` can be absent where the type says it cannot, and `lintChildren.ts` checks for it
 * on purpose. `isLazyList` in `helpers/listEngine.ts` is the predicate that tells the two apart.
 *
 * Kept rather than tightened because tightening it would cost every caller a second question they
 * do not have: the diff, `h` and `generateRenderOutput` all treat a descriptor and a built list
 * alike right up to the point where the engine builds one.
 */
export function isListNode(value: unknown): value is ListNode {
  return value !== null && typeof value === "object" && (value as ListNode)[IS_LIST] === true;
}

/**
 * A built vnode — and EXACTLY the two shapes `VNode` names, `TEXT_TYPE` or
 * `COMPONENT_TYPE`, not "has a `type` and a `name`".
 *
 * The looser spelling is what a predicate cannot afford: `value is VNode` is a
 * promise the callers act on, and an object carrying an unrelated `type` would
 * be waved through into `result` and reach the diff. `h.ts` already asked the
 * exact question in both of its checks — one behind a `@ts-ignore` — so this is
 * their shape, not a widening of it.
 *
 * `debug/renderStability.ts` deliberately asks a LOOSER question ("does this
 * look enough like a node to keep comparing") and keeps its own `VNodeLike`. It
 * is a diagnostic walking two arbitrary values, not the vdom deciding what to
 * render, and tightening it would silently change what it reports.
 */
export function isVNode(value: unknown): value is VNode {
  if (value === null || typeof value !== "object") return false;
  const type = (value as VNode).type;
  return type === TEXT_TYPE || type === COMPONENT_TYPE;
}
