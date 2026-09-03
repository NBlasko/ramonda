/**
 * `ref` is not data, so it is not compared.
 *
 * A component's `ref` is consumed by the framework — it is pointed at the host
 * element when the component is created and never read again — so its identity
 * says nothing about whether the component should re-render. Compared anyway, an
 * inline `ref={createRef()}` handed the child a new object on every parent
 * render, which read as "the props changed" and re-rendered the child every time,
 * forever, with no diagnostic. Measured: one wasted child render per parent
 * render.
 *
 * It stays IN the props bag: `generateRenderOutput` reads `props.key` to put the
 * key on the host element, and a component's `ref` has to survive to creation.
 * Only the comparison ignores it.
 *
 * **"Never read again" is no longer true, and the consequence is measured.** `base/Select.tsx` and
 * `base/TextArea.tsx` both take the element's ref for themselves and hand the CALLER's ref the node
 * by hand, so they read `props.ref` on every update. Ignoring it here means a render whose only
 * change is the ref does not queue the component at all — `rawProps` is not replaced — so a caller
 * who SWAPS its ref keeps the old one pointing at a live node until something else updates that
 * component. `Select` is saved by always having children; `TextArea` is not. Pinned in
 * `__tests__/ControlledTextarea.test.tsx`.
 *
 * Comparing `ref` again would fix it and bring back the wasted render this exists to prevent. The
 * cheaper shape, if it is worth doing: keep it out of the comparison, and hand a changed ref over
 * WITHOUT queueing a render.
 *
 * `key` is deliberately still compared. It could be dropped for the same reason
 * — but a matched component always has an equal key (`areSimilarNodes` refuses a
 * node whose key differs), so ignoring it would remove nothing while adding a
 * rule to remember.
 */
const IGNORED_IN_COMPARISON = "ref";

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

  if (keys1.length === 0 && keys2.length === 0) {
    return true;
  }

  // Counted rather than compared, so `ref` appearing on one side only does not
  // read as a different shape. The subtraction is two `in` checks instead of a
  // filtered copy, because this runs per component per update.
  const length1 = keys1.length - (IGNORED_IN_COMPARISON in obj1 ? 1 : 0);
  const length2 = keys2.length - (IGNORED_IN_COMPARISON in obj2 ? 1 : 0);

  if (length1 !== length2) {
    return false;
  }

  for (const key of keys1) {
    if (key === IGNORED_IN_COMPARISON) continue;
    if (obj1[key] !== obj2[key]) {
      return false;
    }
  }

  return true;
}
