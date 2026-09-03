/**
 * `ref` is compared like every other prop, and it took a measurement to get here.
 *
 * It was NOT, for a reason that was true when it was written (`4ec436c9`): a component's `ref` was
 * pointed at its host element at creation and never read again, so its identity said nothing about
 * whether the component should re-render — while an inline `ref={createRef()}` handed the child a
 * new object every parent render, which read as a props change and re-rendered it forever, with no
 * diagnostic. Measured then: one wasted child render per parent render.
 *
 * **"Never read again" stopped being true.** `base/Select.tsx` and `base/TextArea.tsx` take the
 * element's ref for themselves — one element takes one ref, and a component that loses its own
 * element cannot drive it — so each hands the CALLER's ref the node by hand and re-checks it on
 * every update. With `ref` out of the comparison, a render whose ONLY change is the ref was not a
 * props change at all: the component was never queued, `rawProps` was not even replaced, and the
 * caller's old ref kept pointing at a live node until something else updated that component.
 * Measured on `TextArea`; `Select` was saved only by always having children to rebuild.
 *
 * So a changed ref is a reason to do the work, which is how React answers the same question — the
 * ref lives on the fiber rather than being compared as data, and a changed one defeats the memo
 * bailout. What it costs is the wasted render above, and that is no longer silent:
 * `@ramonda/check`'s `fresh-object-in-props` reports `ref={createRef(…)}` at the call site, and
 * `RMD061` reports a `createRef()` reached from a render, a `@compute` or a `@memoized` builder.
 * The answer to both is the same as it always was — a ref belongs on a field.
 *
 * A stable `ref={this.mine}` costs nothing: the value is identical, so `State.set` never notifies
 * and no render is queued.
 *
 * And it fixes a second case nobody had noticed. `ref` used to be subtracted from the key COUNT on
 * both sides, so `<Child ref={r} />` becoming `<Child />` read as the same shape — the ref was
 * never released. Now it is a props change like any other.
 *
 * `key` is compared for its own reason: a matched component always has an equal key
 * (`areSimilarNodes` refuses a node whose key differs), so ignoring it would remove nothing while
 * adding a rule to remember.
 */
/**
 * Shallow equality over two props bags, by key and by `!==`.
 *
 * `unknown` values, not `string | undefined`. The name and the old signature both said strings, and its
 * ONE caller passes a component's props — a handler, an object, a vnode. The body never treated them as
 * strings either: it counts keys, asks `in`, and compares with `!==`. What kept the mismatch invisible
 * was `rawProps` being typed `RenderableProps<any>` on the runtime, so anything was assignable.
 */
export function arePropsBagsEqual(obj1: Record<string, unknown>, obj2: Record<string, unknown>): boolean {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    if (obj1[key] !== obj2[key]) {
      return false;
    }
  }

  return true;
}
