import { createId } from "../helpers/createId";
import { CONTEXT_READS, CONTEXT_ID } from "../helpers/constants";
import { type Runtime, HOOK_RUNTIME } from "../core/runtime";
import { attach, detach } from "../helpers/constants";
import { Hook } from "./Hook";
import type { State } from "../reactivity/State";
import type { BaseHook } from "../types/HookTypes";
import { diagnose } from "../debug/diagnostics";

/**
 * Internal payload published on a component's runtime context. It hands out one
 * reactive signal per context key, created lazily on first access.
 */
interface ContextChannel {
  getSignal(key: string): State<unknown> | undefined;
}

export interface ContextOptions {
  /**
   * Display name for devtools. The framework cannot see the names you
   * destructure into (`ThemeProvider`/`ThemeConsumer` exist only at the call
   * site), so without this every context shows up as `Provider`/`Consumer`.
   * Set it and they become `<label>Provider` / `<label>Consumer`.
   * Purely cosmetic and DEV-only — stripped from production builds.
   */
  label?: string;
}

/**
 * Creates a context as a pair of hooks:
 *
 *   const [ThemeProvider, ThemeConsumer] = createContext({ color: "default" });
 *
 * Optionally label it for devtools:
 *
 *   const [ThemeProvider, ThemeConsumer] = createContext(
 *     { color: "default" },
 *     { label: "Theme" },
 *   ); // → "ThemeProvider" / "ThemeConsumer" in devtools
 *
 * The Provider is a hook used inside a component. It publishes a per-key signal
 * channel onto that component's runtime context, which every descendant
 * inherits (context objects are prototype-chained per component). So the value
 * is readable by the providing component AND its children:
 *
 *   class Panel extends Component {
 *     theme = this.use(ThemeProvider, () => ({ color: this.color })); // provide + read
 *     render() { return <div>{this.theme.color}</div>; }
 *   }
 *   class Child extends Component {
 *     theme = this.use(ThemeConsumer); // read (any descendant)
 *   }
 *
 * Performance model: the channel exposes the provider's own option signals as
 * the single source of truth — one signal per property, created lazily. A
 * consumer subscribes to the exact key it reads, so a change to one property
 * only wakes consumers of THAT property (true fine-grained). No whole-object
 * State, no sync effect — which also keeps it clean for SSR/hydration.
 *
 * The Provider is a hook rather than a component because the framework is 1-1
 * (every JSX component maps to exactly one HTML element, no fragments), so a
 * pass-through wrapper component is not allowed.
 */
export function createContext<T extends object>(
  defaultValue: T,
  options?: ContextOptions,
): readonly [
  new (owner: Runtime, options: T) => BaseHook<T> & Readonly<T>,
  new (owner: Runtime) => BaseHook<undefined> & T,
] {
  // Unique id of this specific context (e.g. 101).
  const contextId = createId();
  const contextKeys = Object.keys(defaultValue);

  class Provider extends Hook<Record<string, unknown>> {
    constructor(owner: Runtime, options: T) {
      super(owner, options as Record<string, unknown>);

      // Publish a per-key signal channel. The signals ARE the provider's own
      // option signals (lazy, single source of truth): kept current by the
      // hook's option update path, so there is nothing to re-publish.
      const channel: ContextChannel = {
        getSignal: (key) => {
          const hookRuntime = this[HOOK_RUNTIME];
          const signals = hookRuntime.propsSignals;
          const existing = signals.get(key);
          if (existing) return existing;

          // A key this provider does not supply gets NO signal, so the consumer
          // falls back to the default declared in createContext. Reading it
          // through the proxy would create a signal holding `undefined` and the
          // default would never be reached — the fallback below was dead code,
          // and a consumer measured `undefined` where its declared default was
          // meant. An explicitly provided `undefined` still wins, because the
          // key IS present.
          const raw = hookRuntime.rawProps;
          if (!raw || !(key in raw)) return undefined;

          // Reading through the options proxy lazily creates the signal.
          void this.props[key];
          return signals.get(key);
        },
      };
      (owner.context as Record<string | number, unknown>)[contextId] = channel;

      // Reactive reader for the providing component. It reads the options
      // directly — always fresh before render — so the providing component
      // never double-renders when reading its own provided value.
      for (const key of contextKeys) {
        Object.defineProperty(this, key, {
          get: () => this.props[key],
          enumerable: true,
          configurable: true,
        });
      }
    }
  }

  class Consumer extends Hook {
    /** @internal */
    _subscribedKeys = new Set<string>();

    constructor(owner: Runtime) {
      super(owner, undefined);
      const channel = (owner.context as Record<string | number, unknown>)[contextId] as ContextChannel | undefined;

      for (const key of contextKeys) {
        Object.defineProperty(this, key, {
          get: () => {
            // No provider up the tree → fall back to the static default.
            if (!channel) {
              if (__DEV__) {
                // Reported on READ, not on construction: a hook may hold a
                // consumer it only reads down some branches, and constructing
                // one without ever reading it is not a mistake. Deduped per
                // context+key, not per label — unlabeled contexts are all named
                // "Consumer" and would otherwise collapse into one report.
                diagnose(
                  "RMD003",
                  `${contextId}:${key}`,
                  `${Consumer.name} read \`${key}\` with no Provider on any ancestor, so it gets the default below.`,
                  (defaultValue as Record<string, unknown>)[key],
                );
              }
              return (defaultValue as Record<string, unknown>)[key];
            }
            // What is fine-grained here, precisely: the SUBSCRIPTION, not the
            // depth. Attaching a listener on read is the same mechanism signals
            // always used. What changed is that a context is no longer one State
            // over the whole value — `getSignal` hands out one signal PER KEY,
            // so a consumer that read `theme.color` is not woken by a change to
            // `theme.width`. Previously any key woke every consumer.
            //
            // It is NOT deep. `State` holds no proxy: if a key's value is an
            // object, mutating inside it notifies nobody. Replace the value, or
            // put the nested part behind its own key or @compute.
            const signal = channel.getSignal(key);
            if (!signal) {
              return (defaultValue as Record<string, unknown>)[key];
            }

            // Subscribe once per key. Because signals are per-key, this
            // consumer re-renders only when THIS key actually changes.
            if (!this._subscribedKeys.has(key)) {
              this._subscribedKeys.add(key);

              // Unique id: "contextId:runtimeId:key", e.g. "101:5:theme".
              const listenerId = `${contextId}:${owner.id}:${key}`;
              signal[attach]({ id: listenerId, onChange: owner.reBuild });

              // Detach when the consumer's component unmounts.
              owner.clearReactives.push(() => signal[detach](listenerId));
            }

            return signal.get();
          },
          enumerable: true,
          configurable: true,
        });
      }
    }
  }

  if (__DEV__) {
    const label = options?.label;
    if (label) {
      Object.defineProperty(Provider, "name", { value: `${label}Provider` });
      Object.defineProperty(Consumer, "name", { value: `${label}Consumer` });
    }

    /**
     * What devtools shows for a consumer, and why the consumer has to be the one to say it.
     *
     * A consumer has no state and no props: every value it exposes is an accessor over the
     * provider's signals. So it used to appear in the panel as a node with nothing in it — the
     * emptiest thing in the tree being the hook whose entire job is reading.
     *
     * The panel cannot fix that by reading the accessors, because READING IS SUBSCRIBING: the
     * getter attaches a listener on first read, so a panel walking all the keys would widen what
     * the owning component re-renders on. Inspecting must not change behaviour, and here the
     * ordinary read does.
     *
     * So only the already-subscribed keys are read — for those the getter's subscribe branch is a
     * no-op, and `State.get()` registers nothing outside an effect or tracker, which is where the
     * inspector runs. The rest are named rather than valued, which is worth seeing on its own: it
     * is the fine-grained subscription made visible, the difference between "this consumer wakes on
     * `color`" and "on anything in the theme".
     */
    /**
     * Stands in for a key this consumer has never read. Not `undefined`, which would claim the
     * provider supplies nothing — and not the value either, because fetching it would subscribe.
     *
     * Declared INSIDE the guard rather than beside it. At module scope it would be a live string in
     * every build and its removal would depend on the bundler noticing that its only reader was
     * eliminated with the block — the same DCE the diagnostics already lean on, but with no reason
     * to. Nothing that only development needs should have to be dead-code-eliminated when it can
     * simply not exist.
     */
    const NOT_READ = "— not read by this consumer";

    Object.defineProperty(Consumer.prototype, CONTEXT_READS, {
      value(this: InstanceType<typeof Consumer>): Record<string, unknown> {
        const reads: Record<string, unknown> = {};
        for (const key of contextKeys) {
          reads[key] = this._subscribedKeys.has(key) ? (this as unknown as Record<string, unknown>)[key] : NOT_READ;
        }
        return reads;
      },
    });
  }

  // Both halves carry the context's identity, so `@requiresContext(ThemeConsumer)` can ask for
  // "this context" without the app ever seeing the id.
  const identity = { id: contextId, label: options?.label };
  for (const half of [Provider, Consumer]) {
    Object.defineProperty(half, CONTEXT_ID, { value: identity, enumerable: false });
  }

  return [Provider, Consumer] as unknown as readonly [
    new (owner: Runtime, options: T) => BaseHook<T> & Readonly<T>,
    new (owner: Runtime) => BaseHook<undefined> & T,
  ];
}
