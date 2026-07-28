import { devFlags } from "../config";
import { IS_LIST } from "../helpers/constants";
import type { BaseComponent } from "../types/vdom";
import { diagnose } from "./diagnostics";

/**
 * DEV-only: renders twice and reports anything that came out different.
 *
 * ## Why twice, rather than comparing against the previous render
 *
 * Comparing this render's output with the last one conflates two things: a value
 * that was *created inline* and a value that genuinely *changed*. Two calls in the
 * **same tick, with no state change between them**, cannot be confused that way —
 * any difference is, by definition, freshly built. No false positives.
 *
 * It also catches something the previous-render comparison cannot see at all: a render
 * that is not deterministic, reported without needing an SSR round trip to disagree
 * with. But only the part of that class which varies WITHIN a tick —
 * `Math.random()`, `performance.now()` and `new Date()` (which is a fresh object, so its
 * identity differs) are caught every time. A **millisecond clock is not**: measured over
 * 200,000 tries, two consecutive `Date.now()` calls differ in 0.006% of them — the two
 * renders happen microseconds apart, well inside one millisecond. `RMD007` is the check
 * that catches those, because a server render and its hydration are milliseconds to
 * seconds apart, not microseconds. The two checks cover the class between them; neither
 * covers it alone.
 *
 * ## Why it can afford to run on every render
 *
 * Measured on this codebase: `render()` is **3-4% of a commit** (1.56 µs of 48.69
 * for one element, 9.27 of 211.63 for twenty), and **0.04%** for a table of 500
 * rows — because `list()` is lazy, so a second render rebuilds the descriptor and
 * not the items. The biggest components have the smallest share.
 *
 * So there is no need to be clever about *when* to check — and being clever was the
 * wrong instinct anyway. Checking only the first render misses every branch not
 * taken then, which is exactly where handlers live: modals, menus, expanded rows.
 *
 * React's StrictMode is the precedent, and it is strictly heavier: it double-invokes
 * the whole component function *including every hook*, and mounts/unmounts/mounts
 * effects. This doubles only vnode building — no components are constructed (the
 * diff does that), no effects run, no list mappers run.
 *
 * ## The one hazard, and the switch
 *
 * A render with a side effect runs it twice. `RMD001` already makes a state write
 * there an error, so "render is pure" is the framework's position — but a
 * `fetch()` or a `console.log` in render really will happen twice in development.
 * That is the check working, not a malfunction.
 *
 * An app turns it off with `configureDev({ strictRender: false })` — the devtools and
 * every other diagnostic stay. The framework's own test suites do exactly that in
 * their setup files: they observe render ORDER by logging from `render()`, which is
 * precisely the impurity this reports.
 */
export function isStrictRender(): boolean {
  return devFlags.strictRender;
}

/** Bounds one comparison, so a deep or wide tree cannot make a render expensive. */
const MAX_DEPTH = 50;
const MAX_NODES = 500;

type Attributes = Record<string, unknown>;

interface VNodeLike {
  name?: unknown;
  attributes?: Attributes;
  children?: unknown[];
}

/** What kind of instability a differing pair is. */
type Kind = "handler" | "object" | "nondeterministic";

function isPlainObject(value: unknown): value is Attributes {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** How deep `looksRebuilt` compares, and how many array elements it looks at. */
const COMPARE_DEPTH = 2;
const COMPARE_WIDTH = 50;

/**
 * Whether two values are equal by CONTENT while being different objects — which is
 * what "rebuilt in place" looks like.
 *
 * Two levels deep, not one, and a test is the reason: a list's `each` built as
 * `rows.map((row) => ({ ...row }))` is a fresh array of fresh objects, so a
 * one-level compare called it "different contents" and reported non-determinism —
 * a true finding with a misleading message. The interesting fact is that the array
 * was rebuilt, and that only shows one level further in.
 *
 * Bounded in both directions, because this runs on every render in a development
 * build: a long list is compared for its first `COMPARE_WIDTH` elements, and if
 * those match it is called rebuilt. Under-reporting past that is acceptable; a
 * render that is slow to check is not.
 */
function looksRebuilt(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (depth >= COMPARE_DEPTH) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const width = Math.min(a.length, COMPARE_WIDTH);
    for (let i = 0; i < width; i++) if (!looksRebuilt(a[i], b[i], depth + 1)) return false;
    return true;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    for (const key of aKeys) if (!looksRebuilt(a[key], b[key], depth + 1)) return false;
    return true;
  }

  return false;
}

/**
 * Classifies a pair that is not `Object.is`-equal.
 *
 * `undefined` means "this is not instability" — the two values differ in a way that
 * says nothing about how they were built (one side missing entirely, say).
 */
function classify(a: unknown, b: unknown): Kind | undefined {
  if (typeof a === "function" && typeof b === "function") {
    // Same source text, different identity: a closure built in place. A DIFFERENT
    // source means the render picked a different function, which two calls in one
    // tick should never do — so it is reported too, as non-determinism.
    return String(a) === String(b) ? "handler" : "nondeterministic";
  }

  if ((isPlainObject(a) && isPlainObject(b)) || (Array.isArray(a) && Array.isArray(b))) {
    return looksRebuilt(a, b) ? "object" : "nondeterministic";
  }

  // Two primitives that differ between two calls in the same tick: the render is not
  // a function of state. `Math.random()` and `performance.now()` land here every
  // time; `Date.now()` almost never does, because the two calls are inside the same
  // millisecond — see the note at the top, and RMD007 for the check that does catch
  // a clock.
  const bothPrimitive = !isObjectish(a) && !isObjectish(b);
  return bothPrimitive ? "nondeterministic" : undefined;
}

/** A built vnode: `createRamonda` stamps every one with a `type` and a `name`. */
function isVNode(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const node = value as { type?: unknown; name?: unknown };
  return node.type !== undefined && node.name !== undefined;
}

function isObjectish(value: unknown): boolean {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

const DETAIL: Record<Kind, (owner: string, path: string) => string> = {
  handler: (owner, path) =>
    `<${owner} /> builds a new function for \`${path}\` on every render — the source is the same, only the identity is fresh.\n` +
    `That is not just an allocation: an event handler whose identity changed is removed and re-added on the element every render (and a component prop that is a function makes the child re-render).`,
  object: (owner, path) =>
    `<${owner} /> builds a new object or array for \`${path}\` on every render, with the same contents.\n` +
    `A child receiving it re-renders every time, a \`@compute\` reading it recomputes every time, and if it is a list's items every row loses its identity and the whole list is rebuilt.`,
  nondeterministic: (owner, path) =>
    `<${owner} /> produced a different value for \`${path}\` from two renders in the same tick, with no state change between them — so the value does not come from state.`,
};

const FIX: Record<Kind, string> = {
  handler:
    "Give the function a stable identity: a bound method (`onClick={this.submit}`), or `@memoizedHandler` when it has to be built per item — that caches by its arguments, per instance.",
  object:
    "Hold the value somewhere stable instead of rebuilding it: a `@compute` getter (recomputed only when what it reads changes), a field, or a module constant if it never varies.",
  nondeterministic:
    "`render()` must be a function of state and props only. Move `new Date()` / `Math.random()` into `@create` and keep the result in `@state` (or `@persist`), so the value is decided once — and so a server render and its hydration agree (RMD007).",
};

interface Walk {
  owner: string;
  budget: number;
}

/**
 * Compares two outputs of the same `render()` and reports what differs.
 *
 * Called with the output that will actually be used and a second, throwaway one.
 * Building the second is safe: `buildRenderOutput` produces vnodes and nothing
 * else — components are constructed by the diff, `hostTag` is already cached, a
 * render registers no signal dependencies (re-rendering is driven by the listener
 * attached when a signal is created), and `@memoizedHandler` returns the same
 * function for the same arguments, so it shows up as stable rather than as a fault.
 */
export function checkRenderStability(component: BaseComponent, first: unknown, second: unknown): void {
  const walk: Walk = { owner: component.constructor.name, budget: MAX_NODES };
  compareNode(first, second, "", 0, walk);
}

/**
 * **A hook's props bag is deliberately NOT checked**, and that decision came from
 * auditing what the check actually said about one.
 *
 * The callback form of `this.use(Hook, …)` exists in order to be re-evaluated on
 * every owner render — that is its documented contract, and what keeps a hook in step
 * with its owner. So the bag is a fresh object by design, and the values inside it are
 * too: a fetcher closing over `self.props.id` cannot be a stable function, and a query
 * key is an array literal that `@ramonda/query` handles on purpose (it compares the
 * parts, measured at 31 ns). Reporting those produced a warning per hook per app with
 * no action behind it, which is how a diagnostic teaches people to ignore it.
 *
 * The churn is real and it is documented where it belongs — a `@compute` bag is the
 * cure when an effect or a compute reads the bag — but it is not this check's business.
 */

function compareNode(a: unknown, b: unknown, path: string, depth: number, walk: Walk): void {
  if (depth > MAX_DEPTH || walk.budget <= 0) return;
  walk.budget--;

  if (Object.is(a, b)) return;

  // A `list()` descriptor. Its mapper has not run, so there is nothing deep to
  // compare — but `each` is the interesting part: rebuilt items are how a list
  // silently loses every row's identity.
  const aList = (a as { [IS_LIST]?: true })?.[IS_LIST];
  const bList = (b as { [IS_LIST]?: true })?.[IS_LIST];
  if (aList && bList) {
    const aOptions = (a as { options?: Attributes }).options ?? {};
    const bOptions = (b as { options?: Attributes }).options ?? {};

    // `each` only — the function options (`render`, `as`, `key`) are declared inline
    // by design, and a fresh one costs nothing: an item scope is reused on
    // `existing.item === item && !existing.dirty` (listEngine.ts), so the mapper's
    // identity is never compared and never re-invokes anything. Reporting them would
    // put a warning on every list in the app, which is how a diagnostic becomes noise
    // people scroll past.
    compareAttributes(aOptions, bOptions, path ? `${path}.list` : "list", walk, true);
    return;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++) {
      compareNode(a[i], b[i], `${path}[${i}]`, depth + 1, walk);
    }
    return;
  }

  const aNode = a as VNodeLike;
  const bNode = b as VNodeLike;
  const bothVNodes = isObjectish(a) && isObjectish(b) && aNode.name !== undefined && bNode.name !== undefined;

  if (bothVNodes) {
    const tag =
      typeof aNode.name === "string" ? aNode.name.toLowerCase() : ((aNode.name as { name?: string })?.name ?? "?");
    const here = path ? `${path} > ${tag}` : tag;

    if (aNode.attributes && bNode.attributes) {
      compareAttributes(aNode.attributes, bNode.attributes, here, walk);
    }

    const aChildren = aNode.children ?? (aNode.attributes?.children as unknown[] | undefined);
    const bChildren = bNode.children ?? (bNode.attributes?.children as unknown[] | undefined);
    if (Array.isArray(aChildren) && Array.isArray(bChildren)) {
      compareNode(aChildren, bChildren, here, depth + 1, walk);
    }
    return;
  }

  // Two leaves — a text child, most often.
  const kind = classify(a, b);
  if (kind) report(kind, walk.owner, path || "the render output", a, b);
}

function compareAttributes(a: Attributes, b: Attributes, path: string, walk: Walk, skipFunctions = false): void {
  for (const key of Object.keys(a)) {
    if (walk.budget <= 0) return;
    // `children` is walked as a tree, not compared as an attribute.
    if (key === "children") continue;

    const aValue = a[key];
    const bValue = b[key];
    if (skipFunctions && (typeof aValue === "function" || typeof bValue === "function")) continue;
    if (Object.is(aValue, bValue)) continue;

    walk.budget--;

    // A vnode passed as a PROP — `onLoading={<p>…</p>}`, a fallback, children handed
    // down — is a fresh object on every render because that is what JSX is. Walk into
    // it (an inline handler inside it still counts) rather than calling the vnode
    // itself an object built in place.
    if (isVNode(aValue) && isVNode(bValue)) {
      compareNode(aValue, bValue, `${path}.${key}`, 0, walk);
      continue;
    }

    const kind = classify(aValue, bValue);
    if (kind) report(kind, walk.owner, `${path}.${key}`, aValue, bValue);
  }
}

function report(kind: Kind, owner: string, path: string, a: unknown, b: unknown): void {
  diagnose("RMD020", `${owner}:${path}:${kind}`, `${DETAIL[kind](owner, path)}\n\n${FIX[kind]}`, {
    first: a,
    second: b,
  });
}
