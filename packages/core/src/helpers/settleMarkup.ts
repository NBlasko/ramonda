import { COMPONENT_TYPE, IS_LIST, ORIGIN_SYM, TEXT_TYPE } from "./constants";

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
 * ## Only markup is opened
 *
 * Markup is made afresh by the render that returns it and nothing changes it afterwards, so what an
 * old vnode says now is what it said when it was rendered. Data is not like that. A row mutated in
 * place and then copied — `rows[0].value = "x"; rows = rows.map((r) => ({ ...r }))` — compares EQUAL to
 * its copy, because the old object already holds the new value, and a component handed the copy would
 * never render the mutation. That is `PerItemScope.test.tsx`, and it failed when data was opened too.
 *
 * So data is compared by reference wherever it is met — a prop of its own, or an attribute inside
 * markup (`<Row row={r} />`). An object or an array is opened only to reach markup inside it: a slots
 * object `{ header: <H /> }` or an array of JSX settles, and one holding nothing but data does not. Data
 * that should compare by content says so with `@StableProps`.
 *
 * ## Bounded
 *
 * One budget per bag. Running out of it calls the rest different, which is what a reference
 * comparison would have said — the worst case is the old behaviour plus a few hundred cheap steps.
 */
const BUDGET = 500;

const DIFFERENT = 0;
/** Equal by reference or by value, with no markup in it. */
const SAME = 1;
/** Equal, and markup is what was compared. */
const SAME_MARKUP = 2;
type Verdict = typeof DIFFERENT | typeof SAME | typeof SAME_MARKUP;

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

function isPlain(value: unknown): value is Bag {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isMarkupNode(value: unknown): value is MarkupNode {
  const type = (value as { type?: unknown } | null)?.type;
  return type === TEXT_TYPE || type === COMPONENT_TYPE;
}

function isList(value: unknown): value is ListLike {
  return (value as Partial<ListLike> | null)?.[IS_LIST] === true;
}

/** Something this comparison may open: markup, or a container that may hold it. */
function isOpenable(value: unknown): boolean {
  return Array.isArray(value) || isPlain(value) || isMarkupNode(value);
}

function compare(a: unknown, b: unknown, walk: Walk): Verdict {
  if (Object.is(a, b)) return isMarkupNode(a) || isList(a) ? SAME_MARKUP : SAME;
  if (--walk.budget < 0) return DIFFERENT;

  if (isMarkupNode(a)) {
    if (!isMarkupNode(b) || a.type !== b.type || a.name !== b.name) return DIFFERENT;
    // The component that rendered it: it decides the region owner of a list inside, and the style
    // scope of an element.
    if (a[ORIGIN_SYM] !== b[ORIGIN_SYM]) return DIFFERENT;
    // A vnode's own attributes and children are markup by construction, so their members need not
    // hold markup themselves — a `title` string, a handler, a row object are compared as what they are.
    if (!sameAttributes(a.attributes ?? {}, b.attributes ?? {}, walk)) return DIFFERENT;
    return sameMembers(a.children ?? [], b.children ?? [], walk) ? SAME_MARKUP : DIFFERENT;
  }

  if (isList(a)) {
    if (!isList(b) || a.owner !== b.owner) return DIFFERENT;
    // A `list()` descriptor is the same list for the same array and callback — its rows are the
    // engine's business, and an equal pair is what its own whole-list skip already trusts.
    if (a.builder !== undefined || b.builder !== undefined) {
      return a.each === b.each && a.builder === b.builder ? SAME_MARKUP : DIFFERENT;
    }
    // A GROUP — an array among the children, built by `h` — has no callback, only its vnodes.
    return sameMembers(a.vnodes ?? [], b.vnodes ?? [], walk) ? SAME_MARKUP : DIFFERENT;
  }

  // A container is equal only when every member is AND something in it was markup: one holding
  // nothing but data is data, and data is compared by reference.
  if ((Array.isArray(a) && Array.isArray(b)) || (isPlain(a) && isPlain(b))) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return DIFFERENT;
    let markup = false;
    for (const key of keys) {
      if (!Object.hasOwn(b, key)) return DIFFERENT;
      const verdict = compare((a as Bag)[key], (b as Bag)[key], walk);
      if (verdict === DIFFERENT) return DIFFERENT;
      if (verdict === SAME_MARKUP) markup = true;
    }
    return markup ? SAME_MARKUP : DIFFERENT;
  }

  return DIFFERENT;
}

/** Every member equal, for the members of something already known to be markup. */
function sameMembers(a: object, b: object, walk: Walk): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key)) return false;
    if (compare((a as Bag)[key], (b as Bag)[key], walk) === DIFFERENT) return false;
  }
  return true;
}

/** A vnode's attributes: a component's `children` among them is markup, the rest as `sameMembers`. */
function sameAttributes(a: Bag, b: Bag, walk: Walk): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key)) return false;
    const x = a[key];
    const y = b[key];
    if (key === "children" && Array.isArray(x) && Array.isArray(y)) {
      if (!sameMembers(x, y, walk)) return false;
    } else if (compare(x, y, walk) === DIFFERENT) {
      return false;
    }
  }
  return true;
}

/** Whether one prop's new value says the same as its old one. `children` is markup by construction. */
function settles(key: string, next: unknown, prev: unknown, walk: Walk): boolean {
  // JSX children are an ARRAY, and what is between the tags may be plain text. A single node handed
  // over as `children` is markup like any other, and goes the ordinary way.
  if (key === "children" && Array.isArray(next) && Array.isArray(prev)) return sameMembers(next, prev, walk);
  return compare(next, prev, walk) === SAME_MARKUP;
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
    if (settles(key, next[key], prev[key], walk)) {
      (settled ??= { ...next })[key] = prev[key];
    } else if (decided) {
      return next;
    }
  }
  return settled ?? next;
}
