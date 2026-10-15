import { COMPONENT_TYPE, IS_LIST, JSX_CHILDREN, ORIGIN_SYM, TEXT_TYPE } from "./constants";

type Bag = Record<string, unknown>;

/**
 * Markup handed down as a prop, compared by what it says rather than by which object it is.
 *
 * JSX builds new objects on every render, so `<Panel><Big n={1} /></Panel>` hands `Panel` a new
 * `children` array whose `Big` is a new vnode, and a props comparison by reference re-renders `Panel`
 * whenever its parent renders. Measured in a production build, 20 panels of 500 elements each under
 * a parent whose state changed for an unrelated reason: 25 ms and 20 panel renders per change, against
 * 0.2 ms and none once the markup is compared by content. When the markup really changes, the
 * comparison finds the difference at once — 25.4 ms before, 25.5 ms after.
 *
 * ## Only what the framework built is opened
 *
 * A vnode, the children array JSX hands a component, a `list()` and a group are made afresh by the
 * render that returns them, and nothing changes them afterwards — so what an old one says now is what
 * it said when it was rendered. Anything the app built is not like that. A row changed in place and
 * then copied — `rows[0].value = "x"; rows = rows.map((r) => ({ ...r }))` — compares EQUAL to its copy,
 * because the old object already holds the new value, and a child handed the copy would never render
 * the change. The same holds for an object or an array that carries markup: `cols[0].width = 200`
 * followed by a copy of `cols` equals the old `cols`, and so does `cols[0].header = <i />`.
 *
 * So every value the app built is compared by reference, wherever it is met — a prop of its own, an
 * attribute inside markup (`<Row row={r} />`), a slots object `{ header: <H /> }`, an array of nodes.
 * A slots object or array that should compare by content is declared with `@StableProps` on the child,
 * which is the app saying it does not change them in place.
 *
 * ## Bounded
 *
 * One budget per bag. Running out of it calls the rest different, which is what a reference
 * comparison would have said — the worst case is the old behaviour plus a few hundred cheap steps.
 */
const BUDGET = 500;

interface Walk {
  budget: number;
}

interface MarkupNode {
  type: number;
  name: unknown;
  attributes?: Bag;
  children?: unknown[];
  [ORIGIN_SYM]?: number;
}

interface ListLike {
  [IS_LIST]: true;
  owner?: unknown;
  each?: unknown;
  builder?: unknown;
  vnodes?: unknown[];
}

/**
 * A vnode, known by the origin `createRamonda` stamps on every one it makes — a symbol no record of
 * the app's carries. `type` alone is not enough: `{ type: 7, name: "Bolt", qty }` is data, and
 * comparing it as markup looked at its `name` and nothing else.
 */
function isMarkupNode(value: unknown): value is MarkupNode {
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, ORIGIN_SYM)) return false;
  const type = (value as { type?: unknown }).type;
  return type === TEXT_TYPE || type === COMPONENT_TYPE;
}

function isList(value: unknown): value is ListLike {
  return (value as Partial<ListLike> | null)?.[IS_LIST] === true;
}

/** The children array JSX handed a component, as opposed to an array the app passed as `children={…}`. */
function isJsxChildren(value: unknown): value is unknown[] {
  return Array.isArray(value) && (value as { [JSX_CHILDREN]?: true })[JSX_CHILDREN] === true;
}

/** Something this comparison may open: what the framework built. */
function isOpenable(value: unknown): boolean {
  return isMarkupNode(value) || isList(value) || isJsxChildren(value);
}

function same(a: unknown, b: unknown, walk: Walk): boolean {
  if (Object.is(a, b)) return true;
  if (--walk.budget < 0) return false;

  if (isMarkupNode(a)) {
    if (!isMarkupNode(b) || a.type !== b.type || a.name !== b.name) return false;
    // The component that rendered it: a node is reused only for a vnode built where it was
    // (`areSimilarNodes`), so the same markup from another builder renders as something else.
    if (a[ORIGIN_SYM] !== b[ORIGIN_SYM]) return false;
    // An element's own children array is built by `h` with it; a component's arrives among its
    // attributes and is opened only when JSX made it.
    return (
      sameMembers(a.attributes ?? {}, b.attributes ?? {}, walk) && sameMembers(a.children ?? [], b.children ?? [], walk)
    );
  }

  if (isList(a)) {
    if (!isList(b) || a.owner !== b.owner) return false;
    // A `list()` descriptor is the same list for the same array and callback — its rows are the
    // engine's business, and an equal pair is what its own whole-list skip already trusts.
    if (a.builder !== undefined || b.builder !== undefined) return a.each === b.each && a.builder === b.builder;
    // A GROUP — an array among the children, built by `h` — has no callback, only its vnodes.
    return sameMembers(a.vnodes ?? [], b.vnodes ?? [], walk);
  }

  if (isJsxChildren(a)) return isJsxChildren(b) && sameMembers(a, b, walk);

  // Anything the app built, by reference — which `Object.is` above has already answered.
  return false;
}

/** Every member equal: the members of something the framework built. */
function sameMembers(a: object, b: object, walk: Walk): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key) || !same((a as Bag)[key], (b as Bag)[key], walk)) return false;
  }
  return true;
}

/**
 * Whether two values are markup that says the same — the question `settleMarkup` asks of one prop,
 * for a caller that has one pair. RMD022 uses it to stay quiet about what the runtime settles.
 */
export function isSameMarkup(a: unknown, b: unknown): boolean {
  return isOpenable(a) && isOpenable(b) && same(a, b, { budget: BUDGET });
}

/**
 * `next`, with every markup value that says the same as last time replaced by last time's object — so
 * the bag comparison, the props signals and `@watchProp` all see an unchanged prop as unchanged.
 *
 * `decided` is for a COMPONENT, which renders once for the whole bag: when a value that is not
 * markup has already changed, the render is certain and nothing is opened. A HOOK passes `false`,
 * because each of its props is a signal of its own — a `Portal` re-reconciles when its `children`
 * changes, whatever its `target` did.
 */
export function settleMarkup(next: Bag, prev: Bag | undefined, decided: boolean): Bag {
  if (prev === undefined) return next;

  let open: string[] | undefined;
  for (const key in next) {
    const value = next[key];
    const before = prev[key];
    if (Object.is(value, before)) continue;
    if (!Object.hasOwn(prev, key) || !isOpenable(value) || !isOpenable(before)) {
      if (decided) return next;
      continue;
    }
    (open ??= []).push(key);
  }
  if (open === undefined) return next;

  const walk: Walk = { budget: BUDGET };
  let settled: Bag | undefined;
  for (const key of open) {
    if (same(next[key], prev[key], walk)) {
      (settled ??= { ...next })[key] = prev[key];
    } else if (decided) {
      return next;
    }
  }
  return settled ?? next;
}
