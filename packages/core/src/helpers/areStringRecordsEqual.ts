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
 * `key` is deliberately still compared. It could be dropped for the same reason
 * — but a matched component always has an equal key (`areSimilarNodes` refuses a
 * node whose key differs), so ignoring it would remove nothing while adding a
 * rule to remember.
 */
const IGNORED_IN_COMPARISON = "ref";

export function areStringRecordsEqual(
  obj1: Record<string, string | undefined>,
  obj2: Record<string, string | undefined>,
): boolean {
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
