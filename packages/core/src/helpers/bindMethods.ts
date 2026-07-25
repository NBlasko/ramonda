/**
 * Binds every method of a class to its instance, so `this` survives being passed
 * around (`onClick={this.handleClick}`) with no constructor and no arrow fields.
 *
 * ## Why there is a plan
 *
 * Which methods a class has is fixed the moment the class is defined. The old
 * version re-derived that on EVERY construction: `getOwnPropertyNames` (which
 * allocates an array) for each prototype in the chain, then a
 * `getOwnPropertyDescriptor` and a handful of checks per key. For a list of a
 * thousand rows, that is a thousand identical walks producing a thousand
 * identical answers.
 *
 * So the walk happens once per class and the result — the names and functions to
 * bind — is cached against the prototype. Per instance only the part that
 * genuinely differs remains: one `bind` per method.
 *
 * Measured per instance (Node, simplified harness; the real path does more work
 * per key, so the gap here is a lower bound):
 *
 * ```
 *                          8 methods    16 methods   16 methods
 *                          2 used       3 used       16 used
 *   walk + bind (before)   1.473 µs     3.258 µs     4.925 µs
 *   cached plan (after)    0.443 µs     0.867 µs     2.765 µs
 * ```
 *
 * At 16 methods with 3 used, both do the same number of `bind` calls and differ
 * by 3.8x — all of it repeated reflection.
 *
 * A lazy accessor that binds a method on first use was measured too and
 * rejected: it wins when few methods are touched (1.279 µs) but loses badly when
 * most are (7.592 µs against 2.765 µs), because a getter plus a `defineProperty`
 * costs more than a `bind` — and `render()` touches most of a component's
 * methods anyway.
 *
 * ## What the plan does NOT decide
 *
 * Whether an instance already owns a property under that name. That is still
 * checked per instance, and it is not redundant: `Component` assigns `props`
 * and `Hook` assigns `options` before binding runs, so a user method named
 * `props` or `options` must not overwrite them. It also preserves override
 * semantics — the plan keeps the first definition found walking from the
 * most-derived prototype up, which is exactly what an override means.
 *
 * ## The one thing to know about the cache
 *
 * The plan is keyed by prototype, so a class whose prototype is modified AFTER
 * its first instance was built would keep the stale plan. Nothing in normal use
 * does that — hot reload replaces the class, which is a different prototype and
 * therefore a different entry.
 */

type BoundMethod = (...args: never[]) => unknown;
type BindPlan = ReadonlyArray<readonly [string, BoundMethod]>;

const plans = new WeakMap<object, BindPlan>();

const hasOwn = (target: object, key: string): boolean => Object.prototype.hasOwnProperty.call(target, key);

function buildPlan(prototype: object, stopAt: object, skipNames: ReadonlySet<string> | undefined): BindPlan {
  const plan: Array<readonly [string, BoundMethod]> = [];
  // Names already claimed by a more-derived prototype. The old code read this
  // off the instance, which worked only because it bound as it walked; a plan is
  // built without an instance, so it needs to remember for itself.
  const claimed = new Set<string>();

  let current: object | null = prototype;
  while (current && current !== stopAt) {
    for (const key of Object.getOwnPropertyNames(current)) {
      if (key === "constructor") continue;
      if (claimed.has(key)) continue;
      // Internal by convention, and deliberately left unbound — see the note in
      // Component.ts for what that buys and what it costs.
      if (key.startsWith("_")) continue;
      if (skipNames !== undefined && skipNames.has(key)) continue;
      // A user override of one of the framework's own methods stays unbound.
      if (hasOwn(stopAt, key)) continue;

      // The descriptor, not the value: reading `current[key]` would RUN an
      // accessor, computing a @compute during construction.
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || descriptor.get || descriptor.set) continue;

      const value = descriptor.value;
      if (typeof value !== "function") continue;

      claimed.add(key);
      plan.push([key, value as BoundMethod]);
    }

    current = Object.getPrototypeOf(current);
  }

  return plan;
}

/**
 * Binds the instance's methods, using a plan cached per class.
 *
 * @param stopAt    the framework base prototype to stop the walk at; its own
 *                  members are never bound
 * @param skipNames extra names to leave alone (Component uses this for `render`,
 *                  which the framework calls directly)
 */
export function bindInstanceMethods(instance: object, stopAt: object, skipNames?: ReadonlySet<string>): void {
  const prototype = Object.getPrototypeOf(instance);

  let plan = plans.get(prototype);
  if (plan === undefined) {
    plan = buildPlan(prototype, stopAt, skipNames);
    plans.set(prototype, plan);
  }

  const target = instance as Record<string, unknown>;
  for (let i = 0; i < plan.length; i++) {
    const key = plan[i][0];
    // Per instance, and not covered by the plan: `props` / `options` are already
    // own properties by now, and a same-named method must not overwrite them.
    if (hasOwn(instance, key)) continue;
    target[key] = plan[i][1].bind(instance);
  }
}
