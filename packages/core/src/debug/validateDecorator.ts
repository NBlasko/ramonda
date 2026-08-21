/**
 * DEV-only argument checks for decorators.
 *
 * These throw rather than warn. A decorator argument is fixed at the source —
 * it cannot depend on runtime data — so a wrong one is always a mistake, and it
 * surfaces the moment the class is defined, which is the cheapest possible time
 * to find it. A warning here would just scroll past.
 *
 * Every DECORATOR call site sits in `if (__DEV__)`, so none of that reaches production.
 *
 * `delayFault` is the exception, and it is deliberate: `Timeout`/`Interval` call it UNGUARDED, because
 * their delay arrives at runtime rather than as a literal. Re-guarding it there brings back a
 * production `setTimeout(fn, NaN)` — coerced to `0` — which is what `__tests__/prod/TimerDelay.prod.test.tsx`
 * exists to stop.
 */

function fail(decorator: string, message: string): never {
  throw new Error(`[@${decorator}] ${message}`);
}

/**
 * `render` takes no decorator, and the reason is that every one of them either breaks it or means
 * nothing.
 *
 * Measured, one class per decorator:
 * - `@compute render()` CACHES the render on the signals it read. State and props still reach the DOM,
 *   so it looks like it works — and anything the render read that is not a signal freezes the page:
 *   measured, a plain field left `old` on screen while the same component without the decorator showed
 *   `new`. Silent, and re-measured in `__tests__/prod/ComputeOnRender.prod.test.tsx` after the method form
 *   started installing a function; before that it installed an accessor and the page died loudly with
 *   `component.render is not a function`.
 * - `@memoized render()` is the same shape. The render is memoised on its
 *   arguments, it has none, and the component **never updates again**: measured `"0" -> "0"` after
 *   a state write that should have shown `1`. A frozen page and nothing said.
 * - `@created`, `@mounted`, `@updated`, `@destroyed` register the render as a lifecycle callback,
 *   so it runs outside the render pass as well as inside it.
 * - `@catchError render()` makes the render the handler for errors thrown by its own subtree.
 * - `@state`/`@persist` mean "serialise me", which a render is not.
 *
 * None of those is a shade of wrong: there is no decorator this name accepts. `render` is the one
 * member core reserves, and until now it was reserved only by TypeScript's `abstract` — a build
 * with no types refused nothing.
 */
/**
 * The two that CACHE are allowed, and the reason is that forbidding them protected nobody.
 *
 * `@compute get body() { … }` returned from `render()` has always been legal, and it is the same thing:
 * measured, it blinds RMD020 exactly as `@compute render()` does, and freezes on a plain field exactly the
 * same way. So the ban cost one wrapper and taught that the rule was arbitrary.
 *
 * What replaced it is a note rather than a refusal: RMD020 says, once per component, that it can no longer
 * see into this render. It is asked of the DECORATOR, so the wrapper — a `@compute` body returned from
 * `render()` — pays the same cost and is not noted; `debug/cachedRender.ts` says why nothing can tell it
 * apart from two legitimate shapes.
 */
const CACHING = new Set(["compute", "memoized"]);

export function assertNotRender(decorator: string, name: string | symbol): void {
  if (name !== "render") return;
  if (CACHING.has(decorator)) return;
  fail(
    decorator,
    `\`render\` does not take this decorator. It is the method the framework calls to build your element, ` +
      `and this one changes when it runs or means something else entirely. Put the behaviour on a member ` +
      `of its own and call it from \`render\`. (\`@compute\` and \`@memoized\` ARE allowed: they cache the ` +
      `result, and development says so once per component, so you know RMD020 can no longer compare this ` +
      `render's output.)`,
  );
}

function show(value: unknown): string {
  if (typeof value === "function") return "a function";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** The decorator only makes sense on a method. */
export function assertMethod(kind: string, decorator: string, name: string | symbol): void {
  assertNotRender(decorator, name);
  if (kind !== "method") {
    fail(decorator, `Can only decorate a method, but \`${String(name)}\` is a ${kind}.`);
  }
}

/** The decorator only makes sense on a field. */
export function assertField(kind: string, decorator: string, name: string | symbol): void {
  assertNotRender(decorator, name);
  if (kind !== "field") {
    fail(decorator, `Can only decorate a field, but \`${String(name)}\` is a ${kind}.`);
  }
}

/**
 * The decorator makes sense on a method or a getter, and the two install different things.
 *
 * A getter becomes an accessor, so what you read is the value. A METHOD stays a function that returns the
 * value — which is what keeps its declared type true. Installing an accessor for a method was a type lie in
 * both directions: `this.total` was declared `() => number` while it held a `number`, so reading it as the
 * number it is was an error and calling it threw. Measured on both, and the fix was to make the method form
 * behave like one rather than to remove it.
 */
export function assertMethodOrGetter(kind: string, decorator: string, name: string | symbol): void {
  assertNotRender(decorator, name);
  if (kind !== "method" && kind !== "getter") {
    fail(decorator, `Can only decorate a method or a getter, but \`${String(name)}\` is a ${kind}.`);
  }
}

/**
 * A `@compute` METHOD takes no arguments, because its cache is keyed by nothing.
 *
 * One value per component is the whole shape of it, so an argument would be accepted and ignored — the
 * second call with a different argument would hand back the first call's answer. `@memoized` is the
 * decorator keyed BY arguments, and this says so rather than letting the two be confused silently.
 *
 * `fn.length` counts declared parameters up to the first default or rest, so `times(n = 1)` slips through.
 * That case has a usable value in the body, which is the less wrong of the two.
 */
export function assertNoParameters(fn: unknown, decorator: string, name: string | symbol): void {
  if (typeof fn !== "function" || fn.length === 0) return;
  fail(
    decorator,
    `\`${String(name)}\` declares ${fn.length} parameter(s), and a ${decorator} caches one value per ` +
      "component — an argument would be ignored. Use `@memoized` for a value keyed by its arguments.",
  );
}

/**
 * What `setTimeout` and `setInterval` can actually hold: a 32-bit signed millisecond count.
 *
 * Above it the value is TRUNCATED, so the timer fires on the next tick instead of in a month —
 * late becomes immediate, which is the opposite of what the caller asked for. It cost nothing to
 * ignore while only decorator literals reached the check; `Timeout.start(target - now)` is a
 * computed delay, and a target further out than this is an ordinary thing to compute.
 */
const MAX_DELAY = 2_147_483_647;

/**
 * The one judgement about a delay, kept in one place because TWO things ask it.
 *
 * `@interval(ms)` / `@timeout(ms)` ask at class-definition time, where the number is written at the
 * source and a wrong one can only be a mistake. `Timeout.start` / `Interval.start` ask at runtime, where
 * it may have come from props. Same fault, two messages — the decorator names itself, the hook names
 * itself and its method — so this returns the sentence rather than throwing it.
 *
 * **The two ask in different builds, and that follows from the same difference.** The decorator's check
 * is DEV-only, so `@timeout(3_000_000_000)` throws on the author's machine and is still truncated in
 * production. That is a literal: it is met the first time the class is defined in development, and no
 * production input can change it. The hook's is unguarded, because a delay computed from data is only
 * ever wrong in the build that has the data.
 */
export function delayFault(ms: unknown): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return `The delay must be a number of milliseconds, got ${show(ms)}.`;
  }
  if (ms < 0) return `The delay must not be negative, got ${ms}.`;
  if (ms > MAX_DELAY) {
    return (
      `The delay must be at most ${MAX_DELAY} ms (about 24.8 days), got ${ms}. ` +
      `setTimeout truncates it to a 32-bit signed value, so a larger one fires IMMEDIATELY rather than late.`
    );
  }
  return undefined;
}

/** @interval(ms) / @timeout(ms) */
export function assertDelay(ms: unknown, decorator: string): void {
  const fault = delayFault(ms);
  if (fault !== undefined) fail(decorator, fault);
}

/** @onWindow("click") / @onDocument(...) / @onElement(...) */
export function assertEventType(type: unknown, decorator: string): void {
  if (typeof type !== "string" || type.length === 0) {
    fail(decorator, `The event type must be a non-empty string, got ${show(type)}.`);
  }
}

/** A tag the DOM will actually accept as an element name. */
const TAG_PATTERN = /^[a-zA-Z][a-zA-Z0-9-]*$/;

/** @Host("div") */
export function assertHostTag(tag: unknown): void {
  // A callback form — `@Host((p) => p.as ?? "div")` — cannot be checked here.
  // What it returns is checked by assertResolvedHostTag each time it is called.
  if (typeof tag === "function") return;

  if (typeof tag !== "string" || tag.length === 0) {
    fail("Host", `The tag must be a non-empty string, or a callback returning one, got ${show(tag)}.`);
  }
  if (!TAG_PATTERN.test(tag as string)) {
    fail(
      "Host",
      `"${tag}" is not a valid element name. It must start with a letter and contain only letters, digits or dashes.`,
    );
  }
}

/**
 * Checks what a `@Host` tag callback returned. Separate from assertHostTag
 * because the failure is a different one to diagnose: the tag is computed from
 * props, so the message has to name the component whose props produced it rather
 * than point at the decorator.
 */
export function assertResolvedHostTag(tag: unknown, componentName: string): void {
  if (typeof tag !== "string" || tag.length === 0) {
    fail(
      "Host",
      `The tag callback on <${componentName} /> returned ${show(tag)}. It must return a non-empty string — the host element is what the component IS, so there is no sensible default to fall back to.`,
    );
  }
  if (!TAG_PATTERN.test(tag as string)) {
    fail(
      "Host",
      `The tag callback on <${componentName} /> returned "${tag}", which is not a valid element name. It must start with a letter and contain only letters, digits or dashes.`,
    );
  }
}

/** @Host("div", (self) => ({...})) */
export function assertHostProps(props: unknown): void {
  if (props !== undefined && typeof props !== "function") {
    fail(
      "Host",
      `The second argument must be a callback returning the host props, got ${show(props)}. ` +
        `Use @Host("div", (self) => ({ className: self.cls })) — a plain object would be frozen at class-definition time and could never react.`,
    );
  }
}

/** @ShouldUpdateOnPropsChange((self, previous, next) => …) */
export function assertPropsGate(decide: unknown): void {
  if (typeof decide !== "function") {
    fail(
      "ShouldUpdateOnPropsChange",
      `Expects a callback answering "take these props?", got ${show(decide)}. ` +
        `Use @ShouldUpdateOnPropsChange((self, previous, next) => previous.id !== next.id).`,
    );
  }
}

/** @watchProp((p) => p.value) */
export function assertSelector(selector: unknown, decorator: string): void {
  if (typeof selector !== "function") {
    fail(decorator, `Expects a selector function, got ${show(selector)}. Use @${decorator}((p) => p.value).`);
  }
}

/** createSubscriptionDecorator("onStore", connect) */
export function assertConnect(connect: unknown, decorator: string): void {
  if (typeof connect !== "function") {
    fail(
      decorator,
      `createSubscriptionDecorator expects a connect function, got ${show(connect)}. ` +
        `It receives (owner, handler, ...args) and returns the function that undoes the subscription.`,
    );
  }
}

/**
 * What a `connect` handed back.
 *
 * The sharp case is a store whose subscribe returns an OBJECT — `{ unsubscribe }`
 * is a common shape. Nothing would have complained: the effect only treats a
 * FUNCTION as a cleanup, so the object is dropped and the subscription lives on
 * past the component, which is the leak the primitive exists to prevent.
 */
export function assertDisconnect(value: unknown, decorator: string): void {
  if (value === undefined || value === null) return;
  if (typeof value === "function") return;
  // Not `show`: the shape that actually turns up here is `{ unsubscribe }`, and
  // JSON.stringify renders that as `{}` because a function is not JSON — the one
  // message where the default rendering hides the very thing gone wrong.
  const described =
    typeof value === "object"
      ? `an object with keys: ${Object.keys(value as object).join(", ") || "(none)"}`
      : show(value);
  fail(
    decorator,
    `The connect function returned ${described}. It must return a cleanup FUNCTION, or nothing at all — ` +
      `anything else is ignored and the subscription outlives the component. ` +
      `If your store returns a subscription object, wrap it: \`const sub = store.subscribe(handler); return () => sub.unsubscribe();\``,
  );
}

const ENVS = ["client", "server", "shared"];

/** @created({ env: "client" }) */
export function assertEnv(env: unknown, decorator: string): void {
  if (env === undefined) return;
  if (typeof env !== "string" || !ENVS.includes(env)) {
    fail(decorator, `env must be one of ${ENVS.map((e) => `"${e}"`).join(", ")}, got ${show(env)}.`);
  }
}

/**
 * `@StableProps()` with nothing to declare is a mistake rather than a no-op, and a
 * non-string key means the call site passed something that will never match a prop name.
 */
export function assertStablePropKeys(keys: readonly string[]): void {
  if (keys.length === 0) {
    throw new Error('[Ramonda] @StableProps needs at least one prop name: @StableProps("key").');
  }

  for (const key of keys) {
    if (typeof key !== "string" || key.length === 0) {
      throw new Error(`[Ramonda] @StableProps takes prop names as strings; got ${JSON.stringify(key)}.`);
    }
  }
}
