/**
 * DEV-only argument checks for decorators.
 *
 * These throw rather than warn. A decorator argument is fixed at the source —
 * it cannot depend on runtime data — so a wrong one is always a mistake, and it
 * surfaces the moment the class is defined, which is the cheapest possible time
 * to find it. A warning here would just scroll past.
 *
 * Every call site sits in `if (__DEV__)`, so none of this reaches production.
 */

function fail(decorator: string, message: string): never {
  throw new Error(`[@${decorator}] ${message}`);
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
  if (kind !== "method") {
    fail(decorator, `Can only decorate a method, but \`${String(name)}\` is a ${kind}.`);
  }
}

/** The decorator only makes sense on a field. */
export function assertField(kind: string, decorator: string, name: string | symbol): void {
  if (kind !== "field") {
    fail(decorator, `Can only decorate a field, but \`${String(name)}\` is a ${kind}.`);
  }
}

/**
 * @compute is the one decorator that legitimately takes either — a method called
 * as `this.total()` or a getter read as `this.total`. Both are cached the same
 * way, so both are allowed and everything else is not.
 */
export function assertMethodOrGetter(kind: string, decorator: string, name: string | symbol): void {
  if (kind !== "method" && kind !== "getter") {
    fail(decorator, `Can only decorate a method or a getter, but \`${String(name)}\` is a ${kind}.`);
  }
}

/** @interval(ms) / @timeout(ms) */
export function assertDelay(ms: unknown, decorator: string): void {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    fail(decorator, `The delay must be a number of milliseconds, got ${show(ms)}.`);
  }
  if (ms < 0) {
    fail(decorator, `The delay must not be negative, got ${ms}.`);
  }
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
