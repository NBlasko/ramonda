/**
 * DEV-only: how often each `@compute` was READ, and how often the read was answered from cache.
 *
 * ## The question this answers, and the one it deliberately does not
 *
 * A `@compute` is a claim: "this is worth caching". The claim can be false in a way nothing else
 * reports — the compute is invalidated by something that moves on every pass, so every read runs
 * the body, tears the dependency set down and builds it again, and the cache is pure overhead. The
 * answer is correct, so nothing looks wrong.
 *
 * **A compute that never hits is not necessarily a mistake**, and that is why this is a measurement
 * rather than a diagnostic. Its dependencies may genuinely move every time, in which case a plain
 * getter would be no cheaper and the `@compute` costs only the bookkeeping. What is worth showing
 * is the gap between the belief and the behaviour — the same distinction RMD047 draws — and a
 * reader looking at their own component is the one who can close it.
 *
 * RMD024 is the neighbouring check and catches a strictly narrower case: recomputing to an EQUAL
 * value several times running, which is a fault whoever wrote it would want reported. A compute
 * that misses every time and returns something different every time is invisible to it, correct,
 * and still paying for a cache it never uses. That is what this counts.
 *
 * ## Why the counters live on the cache object
 *
 * The compute's cache already exists, one per member per instance, and the getter has it in hand —
 * so a hit costs one property increment and no lookup. A WeakMap keyed by instance would put a
 * lookup on the hot path of every compute read in development, which is the path this is
 * measuring.
 *
 * The REGISTRY is a WeakMap, not a property on the instance: a labelled hook must serialize,
 * enumerate and count exactly like an unlabelled one, and the surest way to keep a development
 * measurement out of all three is to keep it off the object.
 */

/** The counters the `@compute` getter increments, living on its own cache object. */
export interface ComputeCounters {
  hits: number;
  misses: number;
}

const registry = new WeakMap<object, Map<string, ComputeCounters>>();

/** Called once per `@compute` per instance, from the decorator's initializer. */
export function registerCompute(instance: object, member: string, counters: ComputeCounters): void {
  let members = registry.get(instance);
  if (members === undefined) {
    members = new Map();
    registry.set(instance, members);
  }
  members.set(member, counters);
}

/**
 * What the inspector reports for one instance, or `undefined` when it has no `@compute` at all —
 * so a component without one carries no empty section into the panel.
 *
 * A member that has never been READ is left out rather than shown as `0/0`: it is not a compute
 * earning nothing, it is a compute nobody has asked for yet, and the two would look the same.
 */
export function computeStatsOf(instance: object): Record<string, ComputeCounters> | undefined {
  const members = registry.get(instance);
  if (members === undefined) return undefined;
  let out: Record<string, ComputeCounters> | undefined;
  for (const [member, counters] of members) {
    if (counters.hits === 0 && counters.misses === 0) continue;
    (out ??= {})[member] = { hits: counters.hits, misses: counters.misses };
  }
  return out;
}
