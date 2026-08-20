import { devFlags } from "../config";
import { isPlainObject, valueEqualThorough } from "../helpers/valueEqual";
import { isListNode } from "../vdom/guards";
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
 * identity differs — reported as `instance`) are caught every time. A **millisecond clock is not**: measured over
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
 * The cheap half of the idea is the half worth having. Doubling a whole component —
 * its hooks, its effects mounted and unmounted and mounted again — costs far more
 * than the answer is worth. This doubles only vnode building: no components are
 * constructed (the diff does that), no effects run, no list mappers run.
 *
 * ## The one hazard, and the switch
 *
 * A render with a side effect runs it twice — and so does a `list()` row callback, which
 * `listEngine.ts` builds twice for the same reason. `RMD001` already makes a state write
 * there an error, so "render is pure" is the framework's position — but a
 * `fetch()` or a `console.log` in a render, or in a row, really will happen twice in
 * development.
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
  type?: unknown;
  name?: unknown;
  attributes?: Attributes;
  children?: unknown[];
}

/** What kind of instability a differing pair is. */
export type Kind = "handler" | "object" | "instance" | "nondeterministic";

/**
 * Classifies a pair that is not `Object.is`-equal.
 *
 * `undefined` means "this is not instability" — the two values differ in a way that
 * says nothing about how they were built (one side missing entirely, say).
 */
export function classify(a: unknown, b: unknown): Kind | undefined {
  if (typeof a === "function" && typeof b === "function") {
    // Same source text, different identity: a closure built in place. A DIFFERENT
    // source means the render picked a different function, which two calls in one
    // tick should never do — so it is reported too, as non-determinism.
    return String(a) === String(b) ? "handler" : "nondeterministic";
  }

  if ((isPlainObject(a) && isPlainObject(b)) || (Array.isArray(a) && Array.isArray(b))) {
    /**
     * Compared THOROUGHLY, because the answer picks between two sentences that mean different
     * things: "rebuilt with the same contents" asks the app to hold the value somewhere stable,
     * while "not a function of state" tells it to go and find a `Math.random()`. Getting that wrong
     * sends a reader looking for something they never wrote.
     *
     * `valueEqual`'s default bounds are sized for `resolveStable`, which runs per prop per render
     * and only has to CHOOSE a reference — so past a bound it answers "different", which costs it a
     * fresh reference and nothing more. Read as evidence here, that same answer was a verdict about
     * contents nobody had looked at: measured, `() => ({ children: <div><h2 /></div> })` is two
     * levels past the default depth, so every JSX value handed to a hook was reported as "does not
     * come from state", with advice about randomness under it.
     */
    return valueEqualThorough(a, b) ? "object" : "nondeterministic";
  }

  /**
   * Anything else with a prototype — a `Date`, a `Map`, a `Set`, a class instance.
   *
   * Two of them with different identities were CONSTRUCTED by this render: a stable field or
   * module constant passes `Object.is` long before reaching here. So the fault and the fix are
   * the same as a plain object's, and only the wording differs — the contents cannot be read,
   * because `valueEqual` walks own enumerable keys and a `Map`'s entries are not those.
   *
   * The test to remember: `classify(new Date(1), new Date(2))` answers `instance`. Without this
   * branch it answers `undefined`, and a `Date` is then reported in no position at all — not as a
   * prop, not as an attribute, not as a child — while `purityGuard.ts` lists it under what covers
   * the clock.
   *
   * PROTOTYPE identity, not `constructor`: a `class` written inside a render is a new constructor
   * on every call, so two of its instances share nothing and are a different value rather than a
   * rebuilt one.
   */
  if (isObjectish(a) && isObjectish(b)) {
    const samePrototype = Object.getPrototypeOf(a) === Object.getPrototypeOf(b);
    return samePrototype ? "instance" : "nondeterministic";
  }

  // Two primitives that differ between two calls in the same tick: the render is not
  // a function of state. `Math.random()` and `performance.now()` land here every
  // time; `Date.now()` almost never does, because the two calls are inside the same
  // millisecond — see the note at the top, and RMD007 for the check that does catch
  // a clock.
  const bothPrimitive = !isObjectish(a) && !isObjectish(b);
  return bothPrimitive ? "nondeterministic" : undefined;
}

/**
 * Looks enough like a vnode to keep comparing — `type` and `name` present, and
 * deliberately NOT `vdom/guards.ts`'s `isVNode`, which demands one of the two
 * real `type` values.
 *
 * This walks two arbitrary render outputs looking for instability, so a thing
 * that merely resembles a node is still worth descending into; the vdom's guard
 * decides what may reach the diff, which is a promise this cannot make.
 */
function isVNode(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const node = value as VNodeLike;
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
  instance: (owner, path) =>
    `<${owner} /> constructs a new object for \`${path}\` on every render — a \`Date\`, a \`Map\`, a \`Set\` or a class instance.\n` +
    `A child receiving it re-renders every time and a \`@compute\` reading it recomputes every time. Its contents are not compared here, so this says the object is FRESH, not that it changed.`,
  nondeterministic: (owner, path) =>
    `<${owner} /> produced a different value for \`${path}\` from two renders in the same tick, with no state change between them — so the value does not come from state.`,
};

const FIX: Record<Kind, string> = {
  handler:
    "Give the function a stable identity: a bound method (`onClick={this.submit}`), or `@memoized` when it has to be built per item — that caches by its arguments, per instance.",
  object:
    "Hold the value somewhere stable instead of rebuilding it: a `@compute` getter (recomputed only when what it reads changes), a field, or a module constant if it never varies.\n" +
    "PER ITEM, none of those works — a `@compute` belongs to the component, not to the row. `@memoized` is the one that does: it caches by its arguments, per instance, and it caches a value as readily as a handler.",
  instance:
    "Construct it once and keep it: a field, a `@compute` getter, or a module constant. If it is a clock — `new Date()` — decide the value once in `@created` and keep it in `@state`, so a server render and its hydration agree (RMD007).",
  nondeterministic:
    "`render()` must be a function of state and props only. Move `new Date()` / `Math.random()` into `@created` and keep the result in `@state` (or `@persist`), so the value is decided once — and so a server render and its hydration agree (RMD007).",
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
 * attached when a signal is created), and `@memoized` returns the same
 * function for the same arguments, so it shows up as stable rather than as a fault.
 */
export function checkRenderStability(component: BaseComponent, first: unknown, second: unknown): void {
  const walk: Walk = { owner: component.constructor.name, budget: MAX_NODES };
  compareNode(first, second, "", 0, walk);
}

/**
 * The same comparison for ONE list row, called by `listEngine.ts` where the row is built.
 *
 * The double render cannot reach a row: `list()` is lazy on purpose, so the second render rebuilds
 * the descriptor and not the items. The engine is the only place that has two builds to compare,
 * and it is also the cheap place — a row that is reused is never rebuilt, so the cost is one extra
 * builder call per row actually BUILT rather than per row per render.
 *
 * `path` carries no row index, deliberately. `diagnose` keys a report by owner, path and kind, so
 * an index would turn one mistake in one callback into ten thousand reports.
 */
export function checkRowStability(owner: string, path: string, first: unknown, second: unknown): void {
  const walk: Walk = { owner, budget: MAX_NODES };
  compareNode(first, second, path, 0, walk);
}

/**
 * **A hook's props bag is deliberately NOT checked**, and that decision came from
 * auditing what the check actually said about one.
 *
 * A props bag is a fresh object whenever its callback runs, and the values inside it
 * are too: a fetcher closing over `self.props.id` cannot be a stable function, and a
 * query key is an array literal that `@ramonda/query` handles on purpose (it compares
 * the parts, measured at 31 ns). Reporting those from here produced a warning per hook
 * per app with no action behind it, which is how a diagnostic teaches people to ignore
 * it.
 *
 * The churn is real, and RMD022 is the check that owns it — with a run counter, so it
 * speaks only for a value that keeps being rebuilt without ever moving. That is a
 * judgement about a props callback across renders, which this check cannot make: it
 * compares two outputs of one render, and knows nothing about the last one.
 */

function compareNode(a: unknown, b: unknown, path: string, depth: number, walk: Walk): void {
  if (depth > MAX_DEPTH || walk.budget <= 0) return;
  walk.budget--;

  if (Object.is(a, b)) return;

  /**
   * The two things `IS_LIST` brands, which need opposite treatment.
   *
   * **A built REGION** — an array in children position, so a `.map()`, a `filter`, an array
   * literal. `h.ts` wraps it in the same branded shape a `list()` has, and its rows are already
   * BUILT: they sit in `vnodes`, in both outputs, because both renders ran the `.map()`. Comparing
   * them costs nothing — nobody has to build anything that was not built anyway. Skipping them
   * meant `{items.map((i) => <li onClick={() => …}>)}` was reported when the same `<li>` was
   * written by hand and silent the moment it came from an array.
   *
   * **A `list()` DESCRIPTOR** has no rows yet: the builder is called by the engine during the
   * diff, so there is nothing here to compare but `each` — and rebuilt items are how a list
   * silently loses every row's identity. `listEngine.ts` compares the rows themselves, where they
   * are built and where the item scope exists.
   */
  if (isListNode(a) && isListNode(b)) {
    const aRows = (a as { vnodes?: unknown }).vnodes;
    const bRows = (b as { vnodes?: unknown }).vnodes;
    if (Array.isArray(aRows) && Array.isArray(bRows)) {
      /**
       * Each row is its OWN walk, with its own budget — the same way `listEngine.ts` checks a
       * `list()` row, and for the same reason. Sharing the enclosing budget truncated: measured, a
       * 1000-row `.map()` whose only mistake was on the LAST row went unreported, because
       * `MAX_NODES` ran out around row 500. That bound exists to stop one deep or wide TREE from
       * being expensive, and a run of rows is neither — both renders had already built every one of
       * them, so comparing them is the cheap half.
       *
       * Every row also gets the SAME path — no index. `diagnose` keys a report by owner, path and
       * kind, so an index turns one mistake in one callback into one report per row: measured, a
       * two-row list reported twice. Rows that differ in SHAPE still separate themselves, because
       * the tag and the attribute name are in the path.
       */
      const shared = Math.min(aRows.length, bRows.length);
      for (let i = 0; i < shared; i++) {
        checkRowStability(walk.owner, path, aRows[i], bRows[i]);
      }
      return;
    }

    // `each` only — the BUILDER is declared inline by design, and a fresh one
    // costs nothing: an item scope is reused on `existing.item === item &&
    // !existing.dirty` (listEngine.ts), so the mapper's identity is never
    // compared and never re-invokes anything. Reporting it would put a warning
    // on every list in the app, which is how a diagnostic becomes noise people
    // scroll past.
    const aEach = { each: (a as { each?: unknown }).each } as Attributes;
    const bEach = { each: (b as { each?: unknown }).each } as Attributes;
    compareAttributes(aEach, bEach, path ? `${path}.list` : "list", walk, true);
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

/**
 * Compares one bag of named values: an element's attributes, or — recursively — a plain object
 * handed down as one of them.
 *
 * `depth` is 0 for the element's own attributes and counts descents from there. It decides two
 * things: the bound, and that `children` is skipped only at the top, where it is a vnode tree
 * walked separately. One level down, `children` is an ordinary key of somebody's config object.
 */
function compareAttributes(
  a: Attributes,
  b: Attributes,
  path: string,
  walk: Walk,
  skipFunctions = false,
  depth = 0,
): void {
  for (const key of Object.keys(a)) {
    if (walk.budget <= 0) return;
    // `children` is walked as a tree, not compared as an attribute.
    if (depth === 0 && key === "children") continue;

    const aValue = a[key];
    const bValue = b[key];
    if (skipFunctions && (typeof aValue === "function" || typeof bValue === "function")) continue;
    if (Object.is(aValue, bValue)) continue;

    walk.budget--;

    compareValue(aValue, bValue, `${path}.${key}`, depth, walk);
  }
}

/**
 * Decides one differing pair: descend into it, or name it.
 *
 * **Why descend at all.** Classifying a whole bag from outside it named the wrong fault. Measured,
 * `cfg={{ fn: () => 1 }}` was reported as *"produced a different value … so the value does not come
 * from state"*, under advice to move a `new Date()` or a `Math.random()` into `@created` — for an
 * inline arrow, in an app containing neither. The two bags differ only in a closure's identity,
 * which the thorough compare is right to call different and which this was wrong to explain that
 * way. Descending reports `cfg.fn` as the handler it is.
 *
 * **Arrays too, and that is the common shape**: `cols={[{ key: "name", render: () => … }]}` is a
 * table's column definitions, and it had the same wrong answer for the same reason.
 *
 * **A bag whose SHAPE disagrees is not a rebuild** — a different set of keys, a different length —
 * and descending would walk straight past the extra one. That stays non-determinism, named here.
 */
function compareValue(a: unknown, b: unknown, path: string, depth: number, walk: Walk): void {
  // A vnode passed as a PROP — `onLoading={<p>…</p>}`, a fallback, children handed
  // down — is a fresh object on every render because that is what JSX is. Walk into
  // it (an inline handler inside it still counts) rather than calling the vnode
  // itself an object built in place.
  if (isVNode(a) && isVNode(b)) {
    compareNode(a, b, path, 0, walk);
    return;
  }

  // Only when the contents are NOT equal. Equal contents ARE the finding — a value rebuilt in
  // place, which `classify` names `object` — and there is nothing inside it to blame.
  if (depth < MAX_DEPTH && !valueEqualThorough(a, b)) {
    if (isPlainObject(a) && isPlainObject(b)) {
      const aKeys = Object.keys(a);
      if (aKeys.length !== Object.keys(b).length || aKeys.some((k) => !Object.hasOwn(b, k))) {
        report("nondeterministic", walk.owner, path, a, b);
        return;
      }
      // `skipFunctions` is not passed on: it exempts a `list()`'s inline BUILDER, one level up.
      // A function inside an item is not that, and a fresh one per render costs the row its identity.
      compareAttributes(a, b, path, walk, false, depth + 1);
      return;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        report("nondeterministic", walk.owner, path, a, b);
        return;
      }
      for (let i = 0; i < a.length; i++) {
        if (walk.budget <= 0) return;
        if (Object.is(a[i], b[i])) continue;
        walk.budget--;
        compareValue(a[i], b[i], `${path}[${i}]`, depth + 1, walk);
      }
      return;
    }
  }

  const kind = classify(a, b);
  if (kind) report(kind, walk.owner, path, a, b);
}

function report(kind: Kind, owner: string, path: string, a: unknown, b: unknown): void {
  diagnose("RMD020", `${owner}:${path}:${kind}`, `${DETAIL[kind](owner, path)}\n\n${FIX[kind]}`, {
    first: a,
    second: b,
  });
}
