import { diagnose } from "./diagnostics";
import { classify, type Kind } from "./renderStability";
import { valueEqualThorough } from "../helpers/valueEqual";

/**
 * DEV-only: calls a hook's props callback twice and reports anything that came out
 * different. RMD022 — the same check RMD020 runs on `render()`, on the other place the
 * framework asks the app for a value.
 *
 * ## Why the two belong together
 *
 * `render()` and a props callback are the same kind of thing: code the framework calls,
 * unconditionally, on every render, whose result is compared against the last one. The
 * framework solved that for `render()` — `@memoizedHandler` for functions, `list()` for
 * mapped children — so that writing the natural thing is also the efficient thing. A bag
 * had no such answer, and the churn is not cosmetic: every prop is a signal, so a fresh
 * reference is a change. Measured in core's tests, across three renders of the owner: a
 * hook `@compute` reading a rebuilt array runs three times where one reading a scalar
 * prop runs once, a `@watchProp` on a rebuilt array fires on every update render, and a
 * child component handed a rebuilt function re-renders 3/3.
 *
 * ## Why twice in the same tick, rather than against the previous bag
 *
 * The same reason as RMD020: comparing with the previous render's bag conflates "built
 * inline" with "genuinely changed", and the second is the normal case a bag exists for.
 * Two calls with no state change between them cannot be confused that way — any
 * difference was freshly built.
 *
 * And on EVERY render, not only the first. A callback with an `if` in it only ever proves
 * the branch it took, so a first-render-only check passes the case that breaks later —
 * while reporting the legitimate branch difference as a fault. Blind and noisy at once.
 *
 * ## The hazard, and the switch
 *
 * A callback with a side effect runs it twice. The same position `render()` is held to,
 * for the same reason — a props callback that does more than build an object has a
 * problem this check is describing rather than causing. `configureDev({ strictRender:
 * false })` turns both off; every other diagnostic stays.
 */

/**
 * How many consecutive rebuilds count as churn rather than a coincidence.
 *
 * The same number, for the same reason, as RMD024 in `computeChurn.ts`: one rebuild that happens
 * to produce an equal value is ordinary, and below three real code gets reported for accidents.
 */
const RUNS = 3;

interface Churn {
  /** The value this key held the last time the callback ran. */
  previous: unknown;
  /** Consecutive runs since it last actually moved. */
  equalRuns: number;
}

/**
 * Keyed by the per-`use()`-site cache object, not by the owner instance.
 *
 * Two `this.use(Query, …)` calls on one component are two different questions, and one of them
 * churning says nothing about the other — but they share an owner and a hook name, so anything
 * keyed by those would merge them. The cache object is allocated once per call site and lives
 * exactly as long as the hook does, which is the granularity the counter needs.
 */
const churn = new WeakMap<object, Map<string, Churn>>();

const DETAIL: Record<Kind, (owner: string, key: string) => string> = {
  handler: (owner, key) =>
    `\`${owner}\` built a new function for the \`${key}\` prop on ${RUNS + 1} consecutive runs of its props callback — the source is the same, only the identity is fresh.\n` +
    `Every prop is a signal, so a new identity is a change: a \`@compute\` reading it recomputes, a \`@watchProp\` on it fires, and a subscription whose \`connect\` reads it reconnects — every time the callback runs.`,
  object: (owner, key) =>
    `\`${owner}\` built a new array or object for the \`${key}\` prop on ${RUNS + 1} consecutive runs of its props callback, with the same contents every time.\n` +
    `Every prop is a signal, so a new reference is a change: a \`@compute\` reading it recomputes, a \`@watchProp\` on it fires, and a subscription whose \`connect\` reads it reconnects — for a value that never moved.`,
  instance: (owner, key) =>
    `\`${owner}\` constructed a new object for the \`${key}\` prop on ${RUNS + 1} consecutive runs of its props callback — a \`Date\`, a \`Map\`, a \`Set\` or a class instance.\n` +
    `Every prop is a signal, so a new reference is a change: a \`@compute\` reading it recomputes, a \`@watchProp\` on it fires, and a subscription whose \`connect\` reads it reconnects. Its contents are not compared, so this says the object is FRESH, not that it changed.`,
  nondeterministic: (owner, key) =>
    `\`${owner}\` produced a different value for the \`${key}\` prop from two calls in the same tick, with no state change between them — so the prop does not come from state.\n` +
    `Every run of the callback puts a different value in this prop: as a query key, a new cache entry each time and a fetch that never settles.`,
};

const FIX: Record<Kind, string> = {
  handler:
    "A bound method instead of a closure: `fetch: self.load`, where `load()` reads `this.props` when it is called, so there is nothing to capture and the identity never changes. `@memoizedHandler` when it has to be built per argument.",
  object:
    'Hold it somewhere that HAS an identity and hand that over: a `@compute` (`@compute get key() { return ["user", this.props.id] }`), a field, a module constant — so the callback passes a value along instead of building one. A `@compute` holding the whole bag does it for every value in it at once. If you own the hook, `@StableProps("key")` declares the prop a value and settles it for every call site.',
  instance:
    "Construct it once and hand that one over: a field, a `@compute`, or a module constant. A `Date` is the common case and rarely wants to be a prop at all — decide the moment once in `@created` and keep it in `@state` (or `@persist`, so it survives hydration).",
  nondeterministic:
    "A props callback must be a function of state and props only. Read the value once in `@created` and keep it in `@state` (or `@persist`, so it survives hydration), or read it in the handler that needs it.",
};

/**
 * Compares two bags built by the same callback.
 *
 * One thing is skipped: a prop the hook declared with `@StableProps`. The framework already
 * holds one identity for it while the contents are equal, so reporting it would report the
 * fix as the fault.
 */
export function checkPropsStability(
  owner: string,
  first: unknown,
  second: unknown,
  declared: readonly string[] | undefined,
  site: object,
): void {
  if (!isBag(first) || !isBag(second)) return;

  let runs = churn.get(site);
  if (runs === undefined) {
    runs = new Map();
    churn.set(site, runs);
  }

  for (const key of Object.keys(first)) {
    // The hook declared this prop as a value (`static StableProps`), so the framework
    // already keeps one identity for equal contents. Reporting it would be asking the app
    // to fix something the hook took care of.
    //
    // Functions are the exception: a declaration cannot make one comparable, so
    // `resolveStable` leaves it alone and this still reports it. A hook author who lists a
    // function prop gets the report anyway rather than silence.
    if (declared?.includes(key) && typeof (first as Record<string, unknown>)[key] !== "function") continue;

    const a = first[key];
    const b = second[key];

    if (Object.is(a, b)) {
      // Not built in place — it came from somewhere that HAS an identity. Any run it had is over,
      // and leaving the count standing would let a key that was fixed report later from a stale
      // tally.
      runs.delete(key);
      continue;
    }

    const kind = classify(a, b);
    if (kind === undefined) {
      runs.delete(key);
      continue;
    }

    /**
     * A prop that is not a function of state is a fault the first time, so it is reported the
     * first time. It is also the one kind the props cache makes WORSE rather than better: a
     * `Math.random()` in the bag no longer merely churns, it gets frozen into the cached bag and
     * stays until something else invalidates it.
     */
    if (kind === "nondeterministic") {
      runs.delete(key);
      report(kind, owner, key, a, b);
      continue;
    }

    const seen = runs.get(key);
    if (seen === undefined) {
      runs.set(key, { previous: a, equalRuns: 0 });
      continue;
    }

    /**
     * The second condition, and the one this threshold is for.
     *
     * The same-tick pair above only proves the value was built in place. That alone is not worth
     * reporting: `key: ["user", self.props.id]` is built in place too, and when `id` moves the
     * array genuinely differs from last time — so `@StableProps("key")`, which the report
     * recommends, would buy nothing. Comparing across runs is what separates the two.
     *
     * A function cannot be compared this way — two closures with the same body are not equal by
     * any comparison that is safe to make — so for `handler` the count is frequency alone: this
     * key was a fresh function on every one of the last few runs. That is the honest measure for
     * a closure, whose cost is exactly proportional to how often the bag is rebuilt.
     */
    if (kind === "object" && !valueEqualThorough(seen.previous, a)) {
      seen.previous = a;
      seen.equalRuns = 0;
      continue;
    }

    seen.previous = a;
    seen.equalRuns++;
    if (seen.equalRuns < RUNS) continue;

    // Reported once: the dedup key is the prop, and the point is made the first time. Reset so a
    // later burst after a genuine change reports again.
    seen.equalRuns = 0;
    report(kind, owner, key, a, b);
  }
}

/**
 * DEV-only: the safety net under the props-callback cache. RMD027.
 *
 * `useCommon` caches a hook's props callback on the signals it read, so on a render where none of
 * them moved the callback is not called at all. That is right exactly as far as the tracking is:
 * a value that reaches the bag WITHOUT passing through a signal is invisible to it, and the cache
 * will keep serving the bag it built the last time something tracked changed.
 *
 * The shape that breaks is a plain field standing in for state:
 *
 * ```ts
 * class Owner extends Component {
 *   items: string[] = [];                              // not @state
 *   add(x: string) { this.items = [...this.items, x] } // no signal is written
 *   constructor() { super(); this.use(List, () => ({ items: this.items })) }
 * }
 * ```
 *
 * Before the cache this worked by accident: nothing about the write scheduled a render, but the
 * next render for any OTHER reason rebuilt the bag and carried the new array along. With the
 * cache that render no longer calls the callback, so the hook keeps the old array. The value was
 * never reactive; what changed is that the framework stopped compensating for it.
 *
 * ## Why the comparison is by value, not by reference
 *
 * A callback that builds `{ filter: { q } }` returns a NEW object every call by construction —
 * that is the churn the cache exists to absorb, not a fault. Comparing references would report
 * every well-written callback in the app. So the check asks the only question that matters: does
 * the callback produce a different VALUE than the one the cache is holding? If it does, something
 * it reads is not a signal.
 *
 * A function prop is skipped for the same reason it is skipped in `resolveStable` — two closures
 * with the same body are not equal by any comparison that is safe to make, and a fresh closure on
 * an untracked call proves nothing about staleness.
 */
export function checkCachedProps(owner: string, cached: unknown, fresh: unknown): void {
  if (!isBag(cached) || !isBag(fresh)) return;

  for (const key of Object.keys(fresh)) {
    const a = cached[key];
    const b = fresh[key];

    if (typeof b === "function" || typeof a === "function") continue;

    /**
     * Compared THOROUGHLY, for the same reason the wording is: this report tells an app one of its
     * props is holding a value it has moved past. `valueEqual`'s default bounds answer "different"
     * past a depth of two and past fifty array entries, which is safe where a reference has to be
     * chosen and is no basis at all for that sentence — a JSX subtree in a bag is past the first,
     * and a table's worth of rows is past the second, and neither had been compared.
     */
    if (valueEqualThorough(a, b)) continue;

    diagnose(
      "RMD027",
      `${owner}:${key}`,
      `\`${owner}\` has a props callback whose \`${key}\` came out different when nothing it reads had changed.\n` +
        `The callback is cached on the signals it reads, so on a render where none of them moved it is not called — and this prop is now holding a value the app has already moved past. Something feeding \`${key}\` is not reactive, so nothing marked the cache stale.`,
      { cached: a, fresh: b },
    );
  }
}

function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function report(kind: Kind, owner: string, key: string, a: unknown, b: unknown): void {
  diagnose("RMD022", `${owner}:${key}:${kind}`, `${DETAIL[kind](owner, key)}\n\n${FIX[kind]}`, {
    first: a,
    second: b,
  });
}

/**
 * Reports a props bag handed to `use()` as a plain object. The bag itself is refused by the throw
 * in `useCommon`, which happens in every build; this only supplies the explanation and the record.
 *
 * Here rather than beside the throw for the reason the whole module exists: `SPECS` is the largest
 * strippable thing in the package, and every path to it stays inside `if (__DEV__)`.
 */
export function reportObjectPropsBag(owner: string, hookName: string, keys: readonly string[]): void {
  // `keys` goes into the record as a STRING. A record carries values, never live objects, so
  // `reportable` drops an array — see the note beside it.
  const listed = keys.join(", ");
  diagnose(
    "RMD055",
    `${owner}:${hookName}`,
    `\`${owner}\` passed <${hookName} /> a plain object${listed === "" ? "" : ` (${listed})`}.`,
    { keys: listed },
  );
}
