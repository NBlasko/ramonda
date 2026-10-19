import { IS_LIST, ORIGIN_SYM, OWN_CHILDREN } from "./constants";
import { isListNode, isVNode } from "../vdom/guards";

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
 * One budget per key. Running out of it calls that key different, which is what a reference
 * comparison would have said — the worst case is the old behaviour plus a few hundred cheap steps for
 * each markup key. Per key rather than per bag, so a large `children` that is unchanged does not use
 * up what a `header={<H />}` beside it is compared with.
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
 * the app's carries. The shape alone (`isVNode`) is not enough: `{ type: 7, name: "Bolt", qty }` is
 * data, and comparing it as markup looked at its `name` and nothing else.
 */
function isMarkupNode(value: unknown): value is MarkupNode {
  return isVNode(value) && Object.hasOwn(value, ORIGIN_SYM);
}

/**
 * The children array JSX handed a component, as opposed to an array the app passed as `children={…}`.
 * Asked only of a value under the key `children`: DEV brands every array `normalizeChildren` builds,
 * production only a component's children, and asking anywhere else would compare differently in the
 * two builds.
 */
function isJsxChildren(value: unknown): value is unknown[] {
  return Array.isArray(value) && (value as { [OWN_CHILDREN]?: boolean })[OWN_CHILDREN] === true;
}

/** Something this comparison may open, under this key: what the framework built. */
function isOpenable(key: string, value: unknown): boolean {
  return isMarkupNode(value) || isListNode(value) || (key === "children" && isJsxChildren(value));
}

/** `<input>` types whose value the user does not change: a button's label, a hidden value. */
const UNCHANGED_BY_THE_USER: ReadonlySet<string> = new Set(["hidden", "submit", "reset", "button", "image"]);

/** `<input>` types `readonly` does not stop — HTML ignores it on them, and a click still changes them. */
const READONLY_IGNORED: ReadonlySet<string> = new Set(["checkbox", "radio", "file", "range", "color"]);

/**
 * A host `<input>` the user can change, holding a `value` or a `checked`, is never the same markup.
 * What it SHOWS is also what the user did to it, and the render that diffs it is what puts the
 * model's value back: settled, a field whose handler refused a keystroke kept showing it, because the
 * child holding it no longer rendered. Measured against main, where that child rendered on every new
 * `children`.
 *
 * `<input>` only: a host `<textarea>` or `<select>` is refused by the JSX types, and core's `TextArea`
 * and `Select` settle the field themselves. A form field's value is the one state core holds for the
 * model; a `<details open>` or a `<video muted>` is where it STARTS, and settled markup keeps what the
 * user did to it — written back on every render, a FAQ opened as written could never be closed. One
 * the user cannot change — a button's label, a hidden value, `disabled` as written, `readonly` where
 * HTML honours it, a `value` that is `undefined` or `null` (no value, as everywhere in core) — is
 * markup like any other. `readonly` does not stop a checkbox, radio, file, range or color input.
 */
function holdsAFieldValue(node: MarkupNode): boolean {
  if (typeof node.name !== "string") return false;
  // A host tag's name is kept as the DOM spells it, upper case.
  const tag = node.name.toLowerCase();
  if (tag !== "input") return false;
  const attributes = (node.attributes ?? {}) as Record<string, unknown>;
  const type = typeof attributes["type"] === "string" ? (attributes["type"] as string).toLowerCase() : "text";
  if (UNCHANGED_BY_THE_USER.has(type)) return false;
  if (attributes["disabled"] === true) return false;
  const readonly = attributes["readonly"] === true || attributes["readOnly"] === true;
  if (readonly && !READONLY_IGNORED.has(type)) return false;
  return attributes["value"] != null || attributes["checked"] != null;
}

function same(a: unknown, b: unknown, walk: Walk): boolean {
  if (Object.is(a, b)) return true;
  if (--walk.budget < 0) return false;

  if (isMarkupNode(a)) {
    if (!isMarkupNode(b) || a.type !== b.type || a.name !== b.name) return false;
    if (holdsAFieldValue(a)) return false;
    // The component that rendered it: a node is reused only for a vnode built where it was
    // (`areSimilarNodes`), so the same markup from another builder renders as something else.
    if (a[ORIGIN_SYM] !== b[ORIGIN_SYM]) return false;
    // An element's own children array is built by `h` with it; a component's arrives among its
    // attributes and is opened only when JSX made it.
    return (
      sameMembers(a.attributes ?? {}, b.attributes ?? {}, walk) && sameMembers(a.children ?? [], b.children ?? [], walk)
    );
  }

  if (isListNode(a)) {
    if (!isListNode(b)) return false;
    const x = a as unknown as ListLike;
    const y = b as unknown as ListLike;
    // A `list()` descriptor is the same list for the same array and callback — its rows are the
    // engine's business, and an equal pair is what its own whole-list skip already trusts.
    if (x.builder !== undefined || y.builder !== undefined) {
      if (x.each !== y.each || x.builder !== y.builder) return false;
      // Its `owner` is written by whoever renders it, ONTO the descriptor: one handed down as a prop
      // and rendered by the child carries the child's stamp, and its successor arrives unstamped.
      // Keeping the stamped one keeps the very region it already names.
      return x.owner === y.owner || x.owner === undefined;
    }
    // A GROUP — an array among the children, built by `h` — has no callback, only its vnodes.
    return x.owner === y.owner && sameMembers(x.vnodes ?? [], y.vnodes ?? [], walk);
  }

  // Anything the app built, by reference — which `Object.is` above has already answered.
  return false;
}

/** One value under its key: JSX's `children` array member by member, anything else as `same`. */
function sameUnder(key: string, a: unknown, b: unknown, walk: Walk): boolean {
  if (key === "children" && isJsxChildren(a) && isJsxChildren(b)) return sameMembers(a, b, walk);
  return same(a, b, walk);
}

/** Every member equal: the members of something the framework built. */
function sameMembers(a: object, b: object, walk: Walk): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key) || !sameUnder(key, (a as Bag)[key], (b as Bag)[key], walk)) return false;
  }
  return true;
}

/**
 * Whether two values are markup that says the same — the question `settleMarkup` asks of one prop,
 * for a caller that has one pair. RMD022 uses it to stay quiet about what the runtime settles.
 */
export function isSameMarkup(key: string, a: unknown, b: unknown): boolean {
  return isOpenable(key, a) && isOpenable(key, b) && sameUnder(key, a, b, { budget: BUDGET });
}

/**
 * `next`, with every markup value that says the same as last time replaced by last time's object — so
 * the bag comparison, the props signals, `@watchProp` and `@compute` all see an unchanged prop as
 * unchanged.
 *
 * Every markup value is settled, even when some other prop has changed and the component will render
 * anyway: each prop is a signal of its own, and a `@watchProp` on `children` or a `@compute` reading it
 * must not run because a `count` beside it moved. What is cheap is asked first — a reference or a
 * primitive answers at once — and only markup that differs by reference is opened.
 */
export function settleMarkup(next: Bag, prev: Bag | undefined): Bag {
  if (prev === undefined) return next;

  let open: string[] | undefined;
  for (const key in next) {
    const value = next[key];
    const before = prev[key];
    if (Object.is(value, before) || !Object.hasOwn(prev, key)) continue;
    if (isOpenable(key, value) && isOpenable(key, before)) (open ??= []).push(key);
  }
  if (open === undefined) return next;

  let settled: Bag | undefined;
  for (const key of open) {
    if (sameUnder(key, next[key], prev[key], { budget: BUDGET })) (settled ??= { ...next })[key] = prev[key];
  }
  return settled ?? next;
}
