import { IS_LIST } from "../helpers/constants";
import type { ListNode, VNode } from "../types/vdom";

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
 * **One parameter, and there is no second.** A position used to be offered here,
 * and it was a trap in two directions: a row that shows its index has to be
 * rebuilt whenever it moves, which costs a mapper call per moved row; and an
 * index is the one thing that must never become a row's identity, because it
 * follows the POSITION rather than the row. Nothing here hands one out, so
 * neither mistake is available.
 *
 * Give the vnode a `key` when the rows are replaced by fresh objects — see
 * `list`.
 */
export type ItemRender<T> = (item: T) => VNode;

/**
 * A list, as a plain function call in an expression slot.
 *
 * ```tsx
 * <ul>
 *   {list(this.todo, (task) => <TaskRow key={task.id} item={task} />)}
 *   {this.open ? list(this.results, (r) => <li key={r.id}>{r.title}</li>) : null}
 * </ul>
 * ```
 *
 * ## The callback's SHAPE decides whether the rows can be reused
 *
 * Rows are reused when nothing the callback READ has moved, and reads are tracked wherever they happen
 * — any call depth, any module. What cannot be seen is a value read OUTSIDE the callback and closed
 * over, and nothing can look inside a closure to find out. So the engine goes by the one thing it can
 * see:
 *
 * - **an INLINE callback is a new function every render**, so it might have captured anything, and its
 *   rows are rebuilt. Correct, and it costs a callback call and a vnode per row per render — measured
 *   at 10 000 rows over five re-renders as **no extra DOM work at all**, because the diff finds the
 *   rows identical.
 * - **a callback that cannot capture a render's locals** — a method, or a module-level function — has a
 *   stable reference, and its rows are reused:
 *
 * ```tsx
 * class Board extends Component {
 *   row(task: Task) { return <TaskRow key={task.id} item={task} />; }   // reads state INSIDE
 *   render() { return <ul>{list(this.todo, this.row)}</ul>; }
 * }
 * ```
 *
 * **Reach for the method form when a list is large.** A short list keeps every guarantee either way,
 * and what you never get is a stale row — which is the reason the rule is the callback's shape rather
 * than a promise to be careful. See `helpers/listEngine.ts`'s `lastBuilder`.
 *
 * ## Two arguments, and always a function
 *
 * There used to be an options bag — `{ each, as, render, key }` — and every field
 * but the first has since stopped existing. Two positional arguments cannot be
 * written wrong: the items, and the one way to turn an item into markup.
 *
 * The second is ALWAYS a function, never a component class. A shorthand that took
 * the component directly used to exist and reads well, but it leaves nowhere to
 * put a key — the element is built by the component, not by you — so it quietly
 * became the one shape that could not say which row is which. One form, and it is
 * the one that can express everything.
 *
 * ## Which row is which
 *
 * Three answers, tried in this order, and the first two are exact.
 *
 * **The object.** While a row is the same object it is the same row. Nothing is
 * declared and nothing can be got wrong. This covers every update that keeps its
 * references — `filter`, a spread that touches one row, a lens write.
 *
 * **Your key.** The moment an object is NEW — a refetch, a `JSON.parse`, a `for`
 * and `push` inside a `@compute` — the object cannot answer, because nothing here
 * has seen it before. A `key` on the vnode is what still can, and it is left
 * exactly as written: this fills one in only when there is none.
 *
 * **A guess.** With no key and a new object, the incoming array is aligned against
 * the one on screen by what the rows still have in common. It is right for the
 * shapes data takes, and it is a guess — which is why a key beats it, and why a
 * row with nothing to tell it apart is reported (RMD051).
 *
 * ## Why a function and not a `<For>` tag
 *
 * A function in an expression slot is not a tag. It is what the framework already
 * tells people to do when they need vnodes from a function — see RMD011, which
 * points at `{rows()}` for exactly this reason. A `<For>` TAG would be a fragment
 * with extra steps: a tag whose whole job is to stand in for N siblings and be
 * nothing itself, which is the thing Ramonda does not have.
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
export function list<T>(each: Each<T>, render: ItemRender<T>): ListNode {
  // `owner: undefined` is the signal that this is a descriptor rather than a
  // built list — `normalizeChildren` stamps the position, and the diff builds
  // the items.
  const descriptor = {
    [IS_LIST]: true,
    owner: undefined,
    each,
    builder: render,
  };

  if (__DEV__) guardAgainstArrayUse(descriptor);

  return descriptor as unknown as ListNode;
}

/**
 * Says what this is, to whoever reached for it as an array.
 *
 * `list(items, (item) => …)` reads exactly like `items.map((item) => …)`, and the
 * one thing that differs is the thing you cannot see: it does not iterate here.
 * Nothing has run when it returns. What comes back is a DESCRIPTION, and the
 * mapper is called by the diff, once it is holding the region the rows live in —
 * which is what lets a list whose array did not change cost nothing, when the callback is one that can
 * be reused (see above).
 *
 * Anyone who expects an array meets `undefined`, `is not a function` and `is not
 * iterable`, none of which say what happened. TypeScript refuses all three, so
 * reaching here means the types were bypassed — a `any`, a cast, plain JavaScript
 * — and that is exactly when a message is worth having.
 *
 * DEV only: these are FIVE property definitions per `list()` call — `length`, `map`, `forEach`,
 * `filter` and `Symbol.iterator` — which is not something to pay for in a shipped build to explain
 * a mistake the types already refuse. The number used to read "three" here, and the number is the
 * whole argument of the sentence; measured on the descriptor itself, and asserted from both sides
 * in `__tests__/prod/AListInProduction.prod.test.tsx`.
 */
function guardAgainstArrayUse(descriptor: object): void {
  const explain = (reached: string): never => {
    throw new TypeError(
      `\`list()\` returns a description of a list, not an array, so \`${reached}\` has nothing to work with.\n` +
        `Nothing has run yet: the callback is called by the framework when it renders the list, which is what lets a list whose array did not change cost nothing.\n` +
        `Render it — \`<ul>{list(items, (item) => …)}</ul>\` — or, if what you want is an array of values rather than a rendered list, use \`items.map(…)\`.`,
    );
  };

  const asFunction = (name: string) => ({
    value: () => explain(`.${name}()`),
    enumerable: false,
    configurable: true,
  });

  Object.defineProperties(descriptor, {
    length: { get: () => explain(".length"), enumerable: false, configurable: true },
    map: asFunction("map"),
    forEach: asFunction("forEach"),
    filter: asFunction("filter"),
    [Symbol.iterator]: {
      value: () => explain("spreading it"),
      enumerable: false,
      configurable: true,
    },
  });
}

export type { LazyListNode } from "../helpers/listEngine";
export { isLazyList } from "../helpers/listEngine";
