import { attach, detach, HOST_META, HOST_TAG, STATE_KEYS, PERSIST_KEYS, PROPS_GATE } from "../helpers/constants";
import { reportNonSerializableState } from "../debug/serializableState";
import { createId } from "../helpers/createId";
import type { Effect } from "../reactivity/effect";
import { State } from "../reactivity/State";
import { trackerContainer, trackDependency } from "../reactivity/tracker";
import type { HostMeta } from "../types/commonTypes";
import type { LifecycleEnv } from "../types/vdom";
import { type Runtime, type ComponentRuntime, GLOBAL_RUNTIME, COMPONENT_RUNTIME } from "../core/runtime";
import { diagnose } from "../debug/diagnostics";
import { computePhase } from "../debug/renderPhase";
import { memoPhase } from "../debug/purityGuard";
import { recordCompute } from "../debug/computeChurn";
import { STABLE_PROPS } from "../helpers/constants";
import type { BaseHook, PROPS_TYPE } from "../types/HookTypes";
import {
  assertMethod,
  assertField,
  assertMethodOrGetter,
  assertConnect,
  assertDisconnect,
  assertDelay,
  assertEventType,
  assertHostTag,
  assertHostProps,
  assertSelector,
  assertEnv,
  assertStablePropKeys,
  assertPropsGate,
} from "../debug/validateDecorator";

type EnhancedClassFieldDecoratorContext = ClassFieldDecoratorContext<
  { [GLOBAL_RUNTIME]: Runtime } & Record<string, any>
>;

type EnhancedClassMethodDecoratorContext = ClassMethodDecoratorContext<
  // COMPONENT_RUNTIME is optional: components carry it, hooks do not — which is how
  // a decorator can tell the two apart (see @ShouldUpdateOnPropsChange).
  {
    [GLOBAL_RUNTIME]: Runtime;
    [COMPONENT_RUNTIME]?: ComponentRuntime;
  } & Record<string, any>
>;

function ensureStringContextName(contextName: string | symbol, decoratorName: string): string {
  if (typeof contextName === "symbol") {
    throw new Error(`[${decoratorName}] Symbols are not supported.`);
  }
  return contextName;
}

/**
 * The internal primitive every effect-shaped decorator is built on. It stays
 * internal because two of its three parameters are things no app should hold:
 * `alwaysRebuild` (only `@memoizedHandler` has a use for it) and a raw effect
 * body with no contract about what it returns.
 *
 * `createSubscriptionDecorator` is the public door onto it — same machinery, with the
 * cleanup made the point rather than an option. There used to be a second door, `@effect`,
 * which handed the raw body straight through; it was removed in favour of naming what each
 * use of it was for. See the changeset for where each case went.
 *
 * **Registration is not open-ended.** Effects run once per commit, from a queue
 * flushed after the DOM work. Anything pushed here during construction, `@created`
 * or `@mounted` makes that flush; anything pushed AFTER it does not run until some
 * later re-render happens to trigger the next one. Measured: an effect attached
 * from a click handler stayed silent, then fired on an unrelated `@state` change.
 * That is why every decorator here registers from `addInitializer`.
 */
function attachEffect(instance: { [GLOBAL_RUNTIME]: Runtime }, value: (...args: any[]) => any, alwaysRebuild: boolean) {
  const effectId = createId();

  const newEffect: Effect = {
    id: effectId,
    effect: value.bind(instance),
    deps: new Set(),
    shouldRebuild: true,
    cleanup: null,
    alwaysRebuild,
    mutated: new Set<State<unknown>>(),
  };

  instance[GLOBAL_RUNTIME].effects.push(newEffect);
}

// --- Building your own subscription decorators -----------------------------

/**
 * The least an owner must be for a subscription to hang off it: a runtime to
 * attach the effect to. A `Component` and a `Hook` both qualify — a decorator
 * built with `createSubscriptionDecorator` works on either, unless its `connect`
 * asks for more.
 */
export type SubscriptionOwner = { [GLOBAL_RUNTIME]: Runtime };

/**
 * What a `connect` hands back: the function that undoes it, or nothing when
 * there is nothing to undo.
 */
export type Disconnect = (() => void) | void;

/**
 * Turns "subscribe to X, and unsubscribe when the component goes away" into a
 * decorator, so the cleanup is the framework's problem instead of the app's.
 *
 * This is the door onto the same machinery `@interval`, `@timeout` and
 * `@onElement` are built on. Write the `connect` — subscribe, return the
 * unsubscribe — and you get a decorator that runs it after mount and tears it
 * down on destroy:
 *
 * ```ts
 * export const onStore = createSubscriptionDecorator(
 *   "onStore",
 *   (_owner, handler: (state: ThemeState) => void, store: ThemeStore) =>
 *     store.subscribe(handler),
 * );
 *
 * class Panel extends Component {
 *   @state theme = "light";
 *
 *   @onStore(themeStore)
 *   themeChanged(next: ThemeState) {
 *     this.theme = next.theme;
 *   }
 * }
 * ```
 *
 * The decorated method's signature is taken from `connect`'s `handler`
 * parameter, so a method with the wrong shape is a type error at the call site,
 * not a surprise at runtime.
 *
 * **`connect` may read signals.** It runs inside the effect, so reading
 * `owner.props.x` or a `@state` field makes the subscription follow that value:
 * the old one is disconnected, then the new one connected. Read nothing and it
 * subscribes exactly once, which is the usual case.
 *
 * **It must return a function or nothing.** A store that hands back an object —
 * `{ unsubscribe }` is a common shape — is not a cleanup and would be silently
 * dropped, leaving the subscription alive past the component. DEV throws on that
 * rather than letting it leak; wrap it: `return () => sub.unsubscribe()`.
 *
 * @param decoratorName appears in every error this decorator raises, so name it
 *                      what users will write: `"onStore"`, not `"storeSub"`
 * @param connect       subscribes and returns the cleanup
 * @param validateArgs  optional DEV check on the decorator's own arguments. It
 *                      runs at class-definition time — the cheapest moment to
 *                      catch a wrong argument, since a decorator's arguments are
 *                      fixed at the source and can never depend on runtime data.
 *                      `@interval` uses it to reject a non-numeric delay.
 */
export function createSubscriptionDecorator<
  Handler extends (...args: never[]) => void,
  Args extends readonly unknown[] = [],
  Owner extends SubscriptionOwner = SubscriptionOwner,
>(
  decoratorName: string,
  connect: (owner: Owner, handler: Handler, ...args: Args) => Disconnect,
  validateArgs?: (...args: Args) => void,
) {
  if (__DEV__) {
    assertConnect(connect, decoratorName);
  }

  return (...args: Args) => {
    if (__DEV__ && validateArgs !== undefined) {
      validateArgs(...args);
    }

    return function <This>(
      value: Handler,
      // Deliberately NOT `ClassMethodDecoratorContext<This, Handler>`. That type
      // constrains its Value to `(this: This, ...args: any) => any`, which a
      // `never[]` parameter list does not satisfy — and the `never[]` bound is
      // the one worth keeping, because it is what lets a handler with real
      // parameter types (`(s: ThemeState) => void`) be inferred from `connect`.
      // The context is left at its default; the shape of the decorated method is
      // enforced by `value: Handler` above, which is the parameter TypeScript
      // actually checks it against.
      //
      // The owner requirement is a BRAND rather than `This extends Owner`, and the
      // difference is only in the error. With the constraint, a mismatching class
      // produced a message about `access.has` being contravariant and about the
      // decorated method missing from the owner type — true, and unreadable. The
      // brand fails on a named property instead, so the message says what is wrong.
      context: ClassMethodDecoratorContext<This> &
        (This extends Owner
          ? unknown
          : {
              "this decorator's connect() requires an owner this class does not satisfy": Owner;
            }),
    ): void {
      if (__DEV__) {
        assertMethod(context.kind, decoratorName, context.name);
      }
      ensureStringContextName(context.name, decoratorName);

      context.addInitializer(function (this: This) {
        // Safe because of the brand above: a class that does not satisfy `Owner` cannot
        // reach this line, it fails to compile at the decoration site.
        const owner = this as unknown as Owner;
        // Registered from the initializer, not later: see attachEffect for what
        // "later" costs. A dependency-free connect therefore runs once, on the
        // first commit, and its cleanup runs on destroy.
        attachEffect(
          owner,
          () => {
            const handler = value.bind(owner) as Handler;
            const disconnect = connect(owner, handler, ...args);
            if (__DEV__) {
              assertDisconnect(disconnect, decoratorName);
            }
            // Only a function is a cleanup. The DEV check above has already
            // objected to anything else; production keeps the old behaviour of
            // ignoring it rather than crashing a live page.
            return typeof disconnect === "function" ? disconnect : undefined;
          },
          false,
        );
      });
    };
  };
}

export function state(_value: any, context: EnhancedClassFieldDecoratorContext) {
  if (__DEV__) {
    // On a METHOD this used to be silent, and the silence was the problem: the
    // method still worked (the signal held the function), so nothing looked
    // wrong — while the name was registered as serializable state that
    // JSON.stringify then dropped, and every read subscribed the component to a
    // signal that can never change.
    assertField(context.kind, "state", context.name);
  }

  context.addInitializer(function (this) {
    const contextName = ensureStringContextName(context.name, "state");
    const initialValue = this[contextName];
    const runtime = this[GLOBAL_RUNTIME];
    const owner = this.constructor.name;

    // The value straight from the field initializer (`@state x = …`) — the
    // "through the constructor" case. Later writes are checked in the setter below.
    if (__DEV__) reportNonSerializableState(initialValue, contextName, owner);

    const state = new State(initialValue, {
      listener: { id: runtime.id, onChange: runtime.reBuild },
      metaData: contextName,
      owner,
    });

    // Register as serializable state (used by hydration) — always, not dev-only.
    const self = this as any;
    if (!self[STATE_KEYS]) self[STATE_KEYS] = new Set();
    self[STATE_KEYS].add(contextName);

    Object.defineProperty(this, contextName, {
      get() {
        return state.get();
      },
      set(value: any) {
        if (__DEV__) reportNonSerializableState(value, contextName, owner);
        state.set(value);
      },
    });
  });
}

/**
 * Runs after the DOM of an **update** is committed. The post-commit door, and the
 * only place an app can read or correct its own committed DOM.
 *
 * ```tsx
 * class Row extends Component<{ selected: boolean }> {
 *   @updated
 *   keepVisible() {
 *     if (!this.props.selected || this.wasVisible) return;
 *     this.wasVisible = true;
 *     this.element.scrollIntoView({ block: "nearest" });
 *   }
 * }
 * ```
 *
 * ## Why it exists at all
 *
 * Two reasons, and the second is the one that makes it irreplaceable.
 *
 * 1. **You cannot measure your own DOM at the write site.** Updates are batched
 *    through a microtask, so when the handler that changed state returns, the DOM
 *    is not committed yet. "Change it, then measure it" in one function is
 *    impossible by construction.
 * 2. **Not every update has a write site you own.** A parent re-renders you with
 *    new props; a context value changes; a hook you use writes its state; a query
 *    you observe resolves. *Your code never ran* — there is nowhere to hang "and
 *    now measure". Only the framework knows you just committed.
 *
 * `requestAnimationFrame` is the workaround, and it is worse: it lands a frame
 * late, so correcting layout in it (a tooltip's position, an autosizing textarea,
 * a restored scroll offset) shows one frame of the wrong layout. This runs in the
 * same task, before paint.
 *
 * ## It is not `@effect`, and the difference is the point
 *
 * **No dependencies.** Nothing is tracked while it runs, so there is no dependency
 * list to get wrong — and no repeat of the trap that makes an effect the wrong
 * tool here: an effect re-runs when a dependency *changes*, and a dependency that
 * is an array or object rebuilt by a props callback changes on every render. Such
 * an effect fires constantly while looking framework-guarded, and its cleanup tears
 * down whatever it set up each time.
 *
 * **No cleanup contract.** Return nothing. Teardown belongs to `@destroyed`, and a
 * subscription belongs to `createSubscriptionDecorator`.
 *
 * **No previous props or state**, deliberately. The `if` that would need them —
 * `if (previous.id !== this.props.id)` — is reconstructing what changed, and that
 * is `@watchProp`'s job, done before the render and compared by value. The `if`
 * that belongs *here* asks something else: "is the DOM already how I want it?"
 * Only the author can answer that, and it needs nothing from the framework.
 *
 * So the division is:
 *
 * - reacting to a value → `@watchProp` (before the render, one pass)
 * - touching the DOM afterwards → `@updated` (after the commit, unconditional)
 *
 * ## What to know
 *
 * **Not on the first commit** — that is `@mounted`, which runs once with the element
 * already in the document. `@updated` is every commit after it.
 *
 * **It runs unconditionally**, so guard the body if the body is expensive. A
 * `getBoundingClientRect` forces a synchronous layout, which costs orders of
 * magnitude more than the dispatch (~270ns): one field comparison in front of it
 * pays for itself many times over.
 *
 * **Client only.** A server render has no layout and no paint, so there is nothing
 * to measure and nothing to correct.
 *
 * **Children before parents**, so a parent sees its children updated — which is
 * the order measuring wants.
 *
 * **Writing state here schedules another render**, and that is the canonical use:
 * measure, store, render with it. Guard it, or it loops — a runaway is reported as
 * RMD009 in development and stopped in production.
 */
export function updated(value: (...args: any[]) => void, context: EnhancedClassMethodDecoratorContext) {
  if (__DEV__) {
    assertMethod(context.kind, "updated", context.name);
  }

  ensureStringContextName(context.name, "updated");

  context.addInitializer(function (this) {
    this[GLOBAL_RUNTIME].updates.push(() => value.call(this));
  });
}

/**
 * Marks a method whose promise hydration should wait for, keeping the server's
 * markup on screen until it settles.
 *
 * ```tsx
 * class Panel extends Component {
 *   @deferHydration
 *   waitForChunk() {
 *     if (moduleIsCached) return undefined;   // nothing to wait for
 *     return this.load();
 *   }
 * }
 * ```
 *
 * A decorator rather than a magic method name, and that is deliberate: **the
 * method is yours to name.** A framework that reserves `deferHydration` on every
 * class silently changes behaviour the day someone writes a method that happens
 * to be called that — and they would have no reason to suspect it. Every other
 * lifecycle hook here is a decorator for the same reason.
 *
 * ## What deferring does
 *
 * Return a promise and the hydrating client **adopts this component's host and
 * leaves everything inside it exactly as the server wrote it** — no render, no
 * comparison, no replacement. When the promise settles, the ordinary hydration
 * path runs against those untouched nodes. Return nothing and it hydrates now.
 *
 * Only consulted while hydrating. A fresh client build and a server render ignore
 * it, because neither has server markup to protect.
 *
 * It exists for a component whose output depends on something not there yet.
 * `AsyncLoad` is the case that motivated it: the server awaited the import and
 * rendered the real content, but the client's module cache is cold, so its first
 * render would produce the loading fallback — a structure mismatch, which
 * hydration resolves by DESTROYING the markup. The reader watches finished
 * content collapse into a spinner.
 *
 * ## What to know
 *
 * **Return `undefined` whenever you can hydrate immediately.** Deferring costs a
 * delay that a warm cache does not need.
 *
 * **Updates are refused until it resumes.** The subtree is server markup the diff
 * does not know, so a render there would clobber it. Props that change meanwhile
 * are not lost — resuming renders from current state.
 *
 * **The rest of the page does not wait.** Everything outside this subtree becomes
 * interactive immediately, which is the point. Mounts therefore fire in two
 * waves, so "children before parents" holds within each wave rather than across
 * both.
 *
 * **A promise that never settles leaves the content on screen, non-interactive.**
 * The best available failure, but a silent one — DEV reports it as RMD017.
 *
 * Several methods may carry it; hydration waits for all of them.
 */
/**
 * The prototype that holds THIS decorated function — found by identity, not by name.
 *
 * Tells "two declarations in ONE class" from "a subclass specialising the base's".
 * Two initializers whose declarations share an owner are the first; different owners
 * are the second, which must stay quiet.
 *
 * By identity because the name is not enough, and getting that wrong reported the
 * most natural way to specialise a role: a subclass that overrides the method AND
 * re-decorates it keeps the NAME, so a walk looking for the first prototype owning
 * that name returned the SUBCLASS's for both declarations and called them a
 * duplicate. The base's function and the override are different objects on
 * different prototypes, so identity separates them and nothing else does.
 */
function ownerOfDecoration(instance: object, name: string, fn: unknown): object | undefined {
  let proto: object | null = Object.getPrototypeOf(instance);
  while (proto !== null) {
    if (Object.getOwnPropertyDescriptor(proto, name)?.value === fn) return proto;
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}

/**
 * Declares the method that handles an error thrown anywhere below this component.
 *
 * ```tsx
 * @Host("div")
 * class Panel extends Component {
 *   @state failed = "";
 *
 *   @catchError whenSomethingBreaks(e: unknown) {
 *     this.failed = (e as Error).message;
 *   }
 *
 *   render() { … }
 * }
 * ```
 *
 * A decorator rather than a method the framework looks up by name, for the same
 * reason as `@deferHydration`: **the method is yours to name**, and a framework
 * that reserves a name on every class changes behaviour silently the day someone
 * writes a method that happens to be called that. Catching used to work exactly
 * that way — any component with a method called `catchError` became an error
 * boundary — which was the one capability still handed out by naming.
 *
 * **Return `false` to decline**, and the error carries on to the next ancestor
 * that has one; anything else, `undefined` included, means handled. That is how
 * `ErrorBoundary` steps aside when the thing that threw was its own fallback.
 *
 * A METHOD decorator, not a class one, because handling an error is behaviour and
 * a subclass will want `super`: a specialised boundary that reports to Sentry
 * *and* does what the base did is the ordinary case. It is dispatched by name, so
 * overriding the method without re-decorating works.
 *
 * The error walk takes the FIRST ancestor that has a handler, so nesting them
 * works the way the DOM does. Two on one class is a mistake (RMD032) — there is
 * one answer to "who handles this?" — but a subclass declaring its own is an
 * override, and silent.
 */
type CatchErrorOwner = { [COMPONENT_RUNTIME]: ComponentRuntime; [GLOBAL_RUNTIME]: Runtime };

export function catchError<This extends CatchErrorOwner>(
  value: (this: This, e: unknown) => unknown,
  // Typed by its `This`, which is what refuses a hook at COMPILE time: a Hook has no
  // COMPONENT_RUNTIME, so the method's implicit `this` does not satisfy the constraint.
  // The throw in the initializer stays for the build that has no types.
  context: ClassMethodDecoratorContext<This, (this: This, e: unknown) => unknown>,
) {
  if (__DEV__) {
    assertMethod(context.kind, "catchError", context.name);
  }
  const contextName = ensureStringContextName(context.name, "catchError");

  context.addInitializer(function (this) {
    // The error walk climbs COMPONENT_RUNTIME.parent, so a hook is not on it: a
    // handler declared there would sit and never be called. Thrown in every
    // build, like the other component-only decorators.
    const runtime = this[COMPONENT_RUNTIME];
    if (runtime === undefined) {
      throw new Error(
        `[Ramonda] @catchError is for components, not hooks. An error travels up the COMPONENT tree, ` +
          `and a hook is not on it — the handler would never be called. Put it on the component that ` +
          `uses ${this.constructor.name}, or drop it.`,
      );
    }

    if (__DEV__) {
      const owner = ownerOfDecoration(this, contextName, value);
      if (runtime.catchError !== undefined && catchErrorOwners.get(runtime) === owner) {
        diagnose(
          "RMD032",
          `${this.constructor.name}:catchError`,
          `<${this.constructor.name} /> declares @catchError on more than one method.`,
        );
      }
      catchErrorOwners.set(runtime, owner);
    }

    // By NAME, so a subclass overriding the method — with or without `super` —
    // is the one that runs. Capturing `value` would pin the base's body for ever,
    // which is the trap @ShouldUpdateOnPropsChange used to have.
    runtime.catchError = (e: unknown) => (this as unknown as Record<string, (e: unknown) => unknown>)[contextName](e);
  });
}

/** runtime -> the class that last declared its error handler. DEV only. */
const catchErrorOwners = new WeakMap<object, object | undefined>();

export function deferHydration(value: (...args: any[]) => unknown, context: EnhancedClassMethodDecoratorContext) {
  if (__DEV__) {
    assertMethod(context.kind, "deferHydration", context.name);
  }
  ensureStringContextName(context.name, "deferHydration");

  context.addInitializer(function (this) {
    this[GLOBAL_RUNTIME].deferHydrations.push(() => value.call(this));
  });
}

/**
 * The rule a component follows when its parent hands it new props: return `true`
 * to take them, `false` to ignore the update.
 *
 * ```tsx
 * @ShouldUpdateOnPropsChange((self, previous, next) => previous.id !== next.id)
 * @Host("li")
 * class Row extends Component<{ id: number; noisy: unknown }> { … }
 * ```
 *
 * It runs ONLY when the parent re-renders and hands this component a new set of
 * props — never for the component's own `@state` writes, which always render.
 *
 * A CLASS decorator, because it says what the component IS rather than something
 * it does — one answer per class, and nothing a subclass would want to reach with
 * `super`. `self` is inferred from the class it is written on, so nothing needs
 * annotating; it is there for a rule that depends on the instance.
 *
 * **Components only.** A hook has no parent handing it JSX props — its `props`
 * come from the `this.use()` callback and are refreshed on every owner render — so
 * this throws if placed on one rather than sitting there doing nothing.
 *
 * Without it, props are compared shallowly, which is right for almost everything.
 * Reach for this only when you have measured that the default comparison is the
 * problem — a deep object that is rebuilt every render, most often.
 *
 * It was a method decorator, and the move fixed two faults that this shape cannot
 * have. A subclass overriding the decorated METHOD without re-decorating ran the
 * base's body, because the function was captured at decoration time; there is no
 * method to capture now. And declaring it at both levels — the ordinary way to
 * override a rule — was reported as a duplicate, because nothing recorded WHICH
 * class had declared it; the answer now lives on the constructor, where
 * `Object.hasOwn` tells "declared here" from "inherited" exactly.
 *
 * **Refusing an update leaves the props STALE for the component's own later
 * renders too.** Nothing re-reads them until the parent sends another update, so
 * a re-render caused by this component's own `@state` still shows the props it
 * last accepted. That is the trade the rule buys, and it is why it is an escape
 * hatch rather than an optimisation to reach for.
 */
export function ShouldUpdateOnPropsChange<
  C extends (new (...args: any[]) => object) & { readonly __isComponent: true },
>(decide: (self: InstanceOf<C>, previous: PropsOf<C>, next: PropsOf<C>) => boolean) {
  if (__DEV__) {
    assertPropsGate(decide);
  }

  return (ctor: C) => {
    // A hook reaches its inputs a different way (the this.use() callback), and the
    // component update path that consults this rule never runs for one — so on a
    // hook it would be a silent no-op. Thrown in every build, like @Host's; the
    // TYPE already refuses it, so this is for the build that has no types.
    if ((ctor as unknown as { __isComponent?: boolean }).__isComponent !== true) {
      throw new Error(
        `[Ramonda] @ShouldUpdateOnPropsChange is for components, not hooks. A hook's props come from its ` +
          `this.use() callback and refresh on every owner render — there is no parent-driven prop update to gate. ` +
          `Put the decorator on the component that renders <${ctor.name} />, or drop it.`,
      );
    }

    // OWN property, not inherited: a subclass declaring its own rule shadows the
    // base's, which is an override and silent. Two applications on the SAME class
    // both write here, and the second finds the first — the one case worth
    // reporting, and the one the method form could not see.
    //
    // Reported BEFORE the write below, so `hasOwn` is still answering about the previous
    // declaration. The write is unconditional, which is what makes the one written furthest from the
    // class the one that decides — measured, because the order is the opposite of how it reads.
    if (__DEV__ && Object.hasOwn(ctor, PROPS_GATE)) {
      diagnose("RMD040", ctor.name, `<${ctor.name} /> declares more than one.`, { component: ctor.name });
    }

    (ctor as unknown as { [PROPS_GATE]?: unknown })[PROPS_GATE] = decide;
  };
}

export interface LifecycleOptions {
  /**
   * Where the lifecycle method runs.
   * - "shared" (default): on the server and on the client
   * - "client": client only (setInterval, DOM listeners, anything with no
   *   meaning during a server render)
   * - "server": server only
   */
  env?: LifecycleEnv;
}

const DEFAULT_ENV: LifecycleEnv = "shared";

// The lifecycle family (create/mount/destroy) is allowed to run on the server;
// `env` chooses where. An effect is different: always client-only, so it has no
// env option to get wrong.
type LifecyclePhase = "creates" | "mounts" | "destroys";

function isDecoratorContext(value: unknown): value is DecoratorContext {
  return typeof value === "object" && value !== null && "kind" in value;
}

function createLifecycleDecorator(phase: LifecyclePhase, decoratorName: string) {
  const register = (context: EnhancedClassMethodDecoratorContext, env: LifecycleEnv) => {
    if (__DEV__) {
      assertMethod(context.kind, decoratorName, context.name);
    }
    const contextName = ensureStringContextName(context.name, decoratorName);
    context.addInitializer(function (this) {
      this[GLOBAL_RUNTIME][phase].push({
        id: createId(),
        cb: this[contextName].bind(this),
        env,
      });
    });
  };

  // Dual-callable: @created              -> (value, context)
  //                @created({ env })     -> vrati dekorator
  function decorator(
    options?: LifecycleOptions,
  ): (value: unknown, context: EnhancedClassMethodDecoratorContext) => void;
  function decorator(value: unknown, context: EnhancedClassMethodDecoratorContext): void;
  function decorator(arg1?: LifecycleOptions | unknown, arg2?: EnhancedClassMethodDecoratorContext) {
    // Bare usage: the second argument is the decorator context.
    if (isDecoratorContext(arg2)) {
      register(arg2, DEFAULT_ENV);
      return;
    }
    // Factory usage: the first (optional) argument is the options.
    if (__DEV__) {
      assertEnv((arg1 as LifecycleOptions | undefined)?.env, decoratorName);
    }
    const env = (arg1 as LifecycleOptions | undefined)?.env ?? DEFAULT_ENV;
    return (_value: unknown, context: EnhancedClassMethodDecoratorContext) => register(context, env);
  }

  return decorator;
}

/**
 * Runs while the component is being built, before its element exists.
 *
 * **For initialisation, not for side effects.** Two properties make that a rule
 * rather than a style preference, and both were measured:
 *
 * 1. **There is no DOM yet.** The host element is created after `@created` and
 *    inserted by the caller after that, so a `document.querySelector` here finds
 *    nothing of this component — and during a REPLACEMENT it finds the outgoing
 *    instance instead. `@mounted` is the hook that guarantees the element is in the
 *    document.
 * 2. **The instance it replaces is still alive.** On any replacement — a `key`
 *    change, a swapped class, a host tag resolved from props — the new
 *    `@created` runs before the old `@destroyed`. That is not reordered: keeping
 *    this phase free of outside effects is what makes it harmless. Anything
 *    exclusive taken here — a lock, a subscription keyed by identity — would
 *    briefly overlap itself.
 *
 * And one more, from the other end: if the build FAILS after this runs — a throw
 * in `render()`, or in `@created` itself — `@destroyed` still runs, over a
 * component that never finished initialising. So `@destroyed` must tolerate a
 * half-built instance. That was chosen over never cleaning up such a component,
 * because whatever `@created` took would otherwise leak for the life of the page.
 *
 * The method receives its render side (`env: RenderEnv`, `"client"` | `"server"`)
 * as an argument, for the rare shared init that must branch on where it runs.
 * Declaring the parameter is optional.
 */
export const created = createLifecycleDecorator("creates", "created");
/**
 * Runs after the DOM this commit builds is in the document. Measure, focus, hand
 * the node to a library — this is where that belongs, not in `@created`.
 *
 * Within one commit: every child's `@mounted` before its parent's, and a
 * component's `@mounted` before its effects, so `@onElement` listeners are already
 * attached. A component torn down before the commit finishes never mounts at all.
 *
 * The method receives its render side (`env: RenderEnv`, `"client"` | `"server"`)
 * as an argument, so a shared mount can skip a browser-only step (e.g. a fetch)
 * on the server without a `typeof window` check. Declaring the parameter is
 * optional.
 */
export const mounted = createLifecycleDecorator("mounts", "mounted");
/**
 * Runs on teardown, while reactive dependencies are still readable.
 *
 * Runs exactly once, and also for a component whose BUILD failed — see `create`.
 * A throw here is reported and does not stop the rest of the cleanup. Receives the
 * render side (`env: RenderEnv`) as an argument, like `@created`/`@mounted`.
 */
export const destroyed = createLifecycleDecorator("destroys", "destroyed");

/**
 * Syncs derived state BEFORE the render, when a selected prop changes — without
 * the extra re-render an `@effect` would cause. The selector picks the value (it
 * may reach deep: `p => p.foo[5].bar`) and the decorated method receives the new
 * and old value. It does NOT fire on mount; use `@created` for the initial seed.
 *
 * ```ts
 * @watchProp((p) => p.userId)
 * reload(next: [string], previous: [string]) { … }
 * ```
 *
 * **Several selectors, one call.** Pass them as separate arguments and the method runs ONCE when any
 * of them changed, with every value positionally:
 *
 * ```ts
 * @watchProp((p) => p.page, (p) => p.term, (p) => p.sort)
 * reload(next: [number, string, string], previous: [number, string, string]) { … }
 * ```
 *
 * The values are always a TUPLE, even for one selector, and that is about EVOLUTION rather than
 * neatness: with a scalar for one and a tuple for many, adding a second selector to a watcher that
 * already exists silently changes the method's parameter type, and the error a decorator gives for
 * that is `TS1241 Unable to resolve signature of method decorator`, which names nothing. A tuple that
 * grows leaves `next[0]` meaning what it meant.
 *
 * A selector whose value did not change keeps it in BOTH arrays, so `previous[i] === next[i]` is how
 * the method tells which one moved.
 *
 * Do not reach for a single selector returning an array to get the same effect — comparison is
 * `Object.is`, so a fresh array is never equal to the last one and the method fires on every props
 * change with `previous` and `next` holding the same contents. Measured.
 *
 * **The selector needs no annotation**: `props` is typed from the class the decorator is
 * placed on. `This` is only ever mentioned in the decorator CONTEXT and in a conditional
 * type (`PropsOfInstance<This>`), and a conditional is not somewhere TypeScript infers
 * from — so it stays open until the decorator is applied, and the class supplies it. The
 * selectors' return types still fix the tuple, so the method is checked against it.
 *
 * (Annotating it anyway is harmless when the annotation matches.)
 *
 * **The METHOD's parameters still need annotating**, and that is a TypeScript limitation
 * rather than a choice: a decorator does not contextually type the signature it decorates,
 * so unannotated parameters are an implicit `any` (TS7006). Measured while writing this.
 *
 * **On a hook it watches the HOOK's props** — the bag its `this.use()` callback
 * produces — not the owner component's. That is the only reading that makes sense
 * (a hook's selector is typed against its own props), but it was not what happened
 * until 2026-07-28: a hook shares its owner's runtime, so every entry landed in one
 * list and the runtime handed all of them the COMPONENT's props. A hook watching
 * `p => p.userId` therefore read the owner's `userId` if it happened to have one,
 * and never fired when the hook's own prop changed. Fixed by recording which
 * instance each entry belongs to; see `WatchPropEntry.owner`.
 */
export function watchProp<This, S extends readonly ((props: PropsOfInstance<This>) => unknown)[]>(...selectors: S) {
  if (__DEV__) {
    if (selectors.length === 0) {
      throw new Error(
        "[watchProp] Give it at least one selector — `@watchProp((p) => p.userId)`. With none there is " +
          "nothing to watch, so the method could never run.",
      );
    }
    for (const selector of selectors) assertSelector(selector, "watchProp");
  }

  type Values = { [K in keyof S]: ReturnType<S[K]> };

  return function <M extends (next: Values, previous: Values) => void>(
    _value: M,
    context: ClassMethodDecoratorContext<This & { [GLOBAL_RUNTIME]: Runtime } & Record<string, any>, M>,
  ): void {
    if (__DEV__) {
      assertMethod(context.kind, "watchProp", context.name);
    }
    const contextName = ensureStringContextName(context.name, "watchProp");
    context.addInitializer(function (this) {
      this[GLOBAL_RUNTIME].watchProps.push({
        id: createId(),
        selectors: selectors as readonly ((props: unknown) => unknown)[],
        cb: this[contextName].bind(this),
        // Seeded at mount by `seedWatchProps`, one slot per selector.
        lastValues: [],
        // The instance the decorator was put on — a component or a hook. The
        // runtime is shared; the props are not.
        owner: this,
      });
    });
  };
}

function buildKey(args: any[]): string {
  return args
    .map((arg) => {
      const typeofArg = typeof arg;
      if (typeofArg === "string" || typeofArg === "number" || typeofArg === "boolean") {
        return `${typeofArg[0]}:${String(arg)}`;
      }
      throw new Error(`[memoizedHandler] Invalid argument for key: ${arg}. Only string | number | boolean allowed.`);
    })
    .join("|");
}

const memoMap = new WeakMap<any, Map<string, { fn: (...args: any[]) => any; used: boolean }>>();
const cleanUp = (instanceMap: Map<string, { fn: (...args: any[]) => any; used: boolean }>) => {
  for (const [key, entry] of instanceMap.entries()) {
    if (entry.used) {
      entry.used = false;
    } else {
      instanceMap.delete(key);
    }
  }
};

export function memoizedHandler<T extends (...args: any[]) => any>(target: T, context: ClassMethodDecoratorContext): T {
  if (__DEV__) {
    // On a field this already failed, but as `Cannot read properties of
    // undefined (reading 'get')` from inside the framework — an error that names
    // neither the decorator nor the member it was put on.
    assertMethod(context.kind, "memoizedHandler", context.name);
  }

  const originalMethod = target;

  context.addInitializer(function (this: any) {
    let instanceMap = memoMap.get(this);

    if (!instanceMap) {
      instanceMap = new Map();
      memoMap.set(this, instanceMap);
    }

    attachEffect(this, () => cleanUp(instanceMap), true);
  });

  return function (this: any, ...args: any[]) {
    const key = buildKey(args);

    const instanceMap = memoMap.get(this)!;
    let entry = instanceMap.get(key);

    if (entry) {
      entry.used = true;
    } else {
      // Named as the phase it is, so randomness read while BUILDING the handler is
      // reported against the builder rather than against the render that asked for
      // it (RMD021). The distinction matters: whatever the builder captures is cached
      // with the handler, so it is frozen for every later call.
      const previousMemoPhase = __DEV__ ? memoPhase.label : undefined;
      if (__DEV__) {
        memoPhase.label = `${(this as { constructor: { name: string } }).constructor.name}.${String(context.name)}`;
      }

      let fn: unknown;
      try {
        fn = originalMethod.call(this, ...args);
      } finally {
        if (__DEV__) memoPhase.label = previousMemoPhase;
      }

      entry = { fn: fn as (...a: any[]) => any, used: true };
      instanceMap.set(key, entry);
    }

    return entry.fn;
  } as T;
}

/**
 * Marks a non-reactive class field as serializable state for hydration. Unlike
 * @state it creates no signal — it just records that this property must go into
 * (and be restored from) the hydration JSON. Use it for set-once, render-relevant
 * state that isn't a signal. Must hold a JSON-serializable value.
 */
export function persist(_value: unknown, context: EnhancedClassFieldDecoratorContext) {
  if (__DEV__) {
    // Same silent failure as @state on a method, with less to notice: the name
    // lands in PERSIST_KEYS and the hydration blob simply has no entry for it,
    // because a function is not JSON.
    assertField(context.kind, "persist", context.name);
  }

  const contextName = ensureStringContextName(context.name, "persist");
  context.addInitializer(function (this) {
    const self = this as unknown as { [PERSIST_KEYS]?: Set<string> };
    if (!self[PERSIST_KEYS]) self[PERSIST_KEYS] = new Set();
    self[PERSIST_KEYS].add(contextName);
  });
}

/**
 * Sets the component's host (carrier) element. The default host is a transparent
 * `<ramonda-host style="display: contents">`; @Host swaps it for a real element
 * (div, table, g, custom-element, ...). `props` is an optional callback
 * returning attributes to apply to the host — it runs on every render, so it is
 * reactive.
 *
 * (It was a `<template>` until 2026-07-17. That could not survive SSR: the HTML
 * parser moves a template's children into its `.content` fragment, where nothing
 * renders. See constants.ts.)
 *
 *   @Host("nav", (self: Menu) => ({ className: self.open ? "open" : "" }))
 *   class Menu extends Component { ... }
 *
 * Type the host attributes via the callback's parameter annotation `(self: T)`.
 *
 * **The tag may instead be a callback**, so the CALLER chooses the element:
 *
 *   @Host((p: CardProps) => p.as ?? "div")
 *   class Card extends Component<CardProps> { ... }
 *
 *   <Card as="section" />
 *
 * It receives the component's props and must be **pure** — the diff calls it
 * while deciding whether an existing element can be reused, so it runs more than
 * once and must depend on nothing but the props it is handed.
 *
 * One instance's host never changes. The tag is resolved when the component is
 * built and cached for its lifetime, because the host element IS the component:
 * swapping it later would destroy that element and everything attached to it —
 * its state, its listeners, whatever a ref points at. A prop change that would
 * resolve to a different tag does not mutate the host; it fails to match in the
 * diff, and a fresh component is built in its place.
 */
export function Host<C extends (new (...args: any[]) => object) & { readonly __isComponent: true }>(
  tag: string | ((props: PropsOf<C>) => string),
  props?: (self: InstanceOf<C>) => Record<string, unknown>,
) {
  if (__DEV__) {
    assertHostTag(tag);
    assertHostProps(props);
  }

  return (ctor: C) => {
    // A hook has no element, so `@Host` on one describes nothing — and it used to say nothing
    // either: the meta was written to a class no render path ever asks about, and the tag was
    // silently ignored. Thrown in every build, like the other two component-only decorators;
    // the TYPE already refuses it, so this is for the build that has no types.
    if ((ctor as unknown as { __isComponent?: boolean }).__isComponent !== true) {
      throw new Error(
        `[Ramonda] @Host is for components, not hooks. It names the element a component IS, and a ` +
          `hook adds no element — that is the point of a hook. Put @Host on the component that uses ` +
          `${ctor.name}, or drop it.`,
      );
    }

    // Exactly one of `tag` / `tagFromProps` is set, so the render and diff paths
    // never have to decide which of two sources wins.
    const meta: HostMeta =
      typeof tag === "function"
        ? {
            tagFromProps: tag as HostMeta["tagFromProps"],
            props: props as HostMeta["props"],
          }
        : {
            tag: tag.toUpperCase(),
            props: props as HostMeta["props"],
          };

    /**
     * Two `@Host` on ONE class, said in words.
     *
     * It already failed — `configurable: false` below means the second `defineProperty` throws — but
     * with V8's own message: `Cannot redefine property: Symbol(host:meta)`. That names an internal
     * symbol, gives no advice, and points at a line inside this file rather than at the class. For a
     * mistake as easy as writing the decorator twice, it was the worst available report.
     *
     * **A record AND a throw**, which are not alternatives — the same two doors `@ramonda/form`'s
     * `refuse` opens. The throw is the developer's channel and ships in every build, because there is no
     * correct program here: a component is exactly one element, so two answers cannot both be honoured.
     * The RECORD is the collector's, so an app streaming its diagnostics somewhere sees this alongside
     * everything else it has to tidy up — a fault that only throws is invisible to that.
     *
     * What the tier decides is the THROW, not the code. `RMD032` and `RMD040` report and carry on,
     * because one declaration quietly wins and the program still runs, wrongly. This one cannot pick a
     * winner.
     *
     * `hasOwn`, not `in`: a SUBCLASS declaring its own `@Host` overrides the base's, which is how a
     * specialised component changes its element, and it is measured as working. Only two on one class
     * body are refused.
     */
    if (Object.hasOwn(ctor, HOST_META)) {
      if (__DEV__) {
        diagnose("RMD045", ctor.name, `<${ctor.name} /> declares more than one @Host.`, { component: ctor.name });
      }
      throw new Error(
        `[Ramonda] <${ctor.name} /> has more than one @Host. A component is exactly one element, so ` +
          `there is one answer to which — keep the @Host you meant and delete the rest. A SUBCLASS may ` +
          `declare its own, which overrides the base's; this is two on the same class.`,
      );
    }

    Object.defineProperty(ctor, HOST_META, {
      value: meta,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  };
}

/**
 * The instance a class constructs, and the props its constructor takes.
 *
 * **Both are conditional types on purpose**, and that is the whole mechanism behind
 * `@Host`'s and `@StableProps`' type inference. A conditional type is not an inference
 * site, so TypeScript cannot resolve `C` from the decorator's ARGUMENTS — it defers until
 * the decorator is applied, where the decorated class supplies `C`. Only then are the
 * arguments checked, contextually, against a `C` that is finally known.
 *
 * Measured while writing this: the obvious shape — a type parameter sitting directly in the
 * callback's parameter position (`props?: (self: This) => …`) — fixes `This` to `unknown`
 * from an unannotated arrow before the class is ever looked at, which is why `@Host` used to
 * need `(self: Card)` spelled out.
 */
type InstanceOf<C> = C extends new (...args: any[]) => infer I ? I : never;

/**
 * The props of a component or a hook INSTANCE — which is what a method decorator has to
 * work from, since its context is generic in the instance type rather than in the class.
 *
 * Two branches because the two base classes expose it differently: `BaseComponent.props` is
 * public, and a hook's is `protected` and therefore structurally invisible, so `Hook`
 * carries the type in a phantom (`PROPS_TYPE`).
 */
type PropsOfInstance<T> = T extends { props: infer P } ? P : T extends { [PROPS_TYPE]?: infer P } ? P : never;
type PropsOf<C> = C extends new (props: infer P, ...rest: any[]) => any ? P : never;

/**
 * A hook's props, read off its construct signature — `new (runtime, options: Q) => …`.
 *
 * The constraint on the decorated class is `=> BaseHook<any>` rather than `=> object`, and
 * that is what rejects a COMPONENT at compile time: a component instance has no
 * `HOOK_RUNTIME`, so it is not structurally a hook. Constraining the parameters instead
 * does not work — a component's constructor is `(props, context)`, and `keyof` of a loose
 * context type accepts any name, so every check passed.
 */
type HookPropsOf<C> = C extends new (runtime: any, options: infer Q) => any ? Q : never;

/**
 * Declares which of a hook's props are **values** rather than references — so the
 * framework hands back one identity for as long as their contents are equal, and the call
 * site writes the plain literal.
 *
 * ```tsx
 * @StableProps("key")
 * export class Query extends Hook<QueryProps> {}
 * ```
 *
 * ```tsx
 * // …and every caller, with nothing to wrap:
 * private user = this.use(Query, (self: UserCard) => ({
 *   key: ["user", self.props.id],
 * }));
 * ```
 *
 * ## Why the hook declares it, and not the call site
 *
 * That a query key is a value — `["user", 7]` built again is the same question — is the
 * hook's knowledge. Every prop is a signal and a signal compares by reference, so without
 * this the rebuilt array is a *changed* prop at every call site: a `@compute` reading it
 * recomputes, a `@watchProp` on it fires, a subscription reconnects. Measured across three
 * renders of the owner, a compute reading a rebuilt array runs three times where one
 * reading a scalar prop runs once. Stating it here fixes it once instead of asking every
 * caller to know it. A call site using a hook that declared nothing does the same thing by
 * holding the value itself — a `@compute`, a field, a module constant.
 *
 * ## What it cannot cover
 *
 * **Functions.** Two closures with the same body are not equal by any comparison that is
 * safe to make, so a listed function prop is left exactly as it came and RMD022 still
 * reports it — unstable AND silent would be the worst of both. Pass a bound method
 * instead, or `@memoizedHandler` when it has to be built per argument.
 *
 * Contents are compared to a bounded depth, so a deeply nested literal gets a fresh
 * reference rather than a wrong one — the safe direction.
 *
 * ## Notes on the shape
 *
 * A class decorator, like `@Host`, because the declaration is about the hook rather than
 * about any one member — and props are not members at all, they live behind the
 * `this.props` proxy, so there is nothing per-prop to decorate.
 *
 * **It merges with what a parent class declared** rather than replacing it, so a subclass
 * adds to the list and cannot silently drop what the parent relied on.
 *
 * **Hooks only.** A component fails to type-check here, and throws in every build as the
 * backstop for a build with no types: a component's props come from the parent's JSX and
 * are compared by the diff, which is a different mechanism with its own control
 * (`@ShouldUpdateOnPropsChange`).
 *
 * **The names are type-checked** against the hook's props — `@StableProps("kye")` is a
 * compile error that names `"kye"` — with no type argument to write at the call site.
 */
export function StableProps<const K extends readonly string[]>(...keys: K) {
  if (__DEV__) {
    assertStablePropKeys(keys as readonly string[]);
  }

  return <C extends new (runtime: any, options: any) => BaseHook<any>>(
    ctor: C &
      // The names are checked against the hook's OWN props: `C` is inferred from the
      // decorated class, and when a name is not one of its props the parameter type gains a
      // property the class cannot have, so the error names the offending key. Checked
      // through `keyof` rather than by assignability, so an OPTIONAL prop counts as a prop.
      //
      // Written this way round because `Q` cannot be inferred from a constructor PARAMETER:
      // measured, it falls back to its constraint, and every call then failed — including
      // the correct ones.
      ([K[number]] extends [keyof HookPropsOf<C>]
        ? unknown
        : {
            "@StableProps was given a name that is not a prop of this hook": K[number];
          }),
  ) => {
    if ((ctor as unknown as { __isComponent?: boolean }).__isComponent) {
      throw new Error(
        `[Ramonda] @StableProps is for hooks, not components. A component's props come from the parent's ` +
          `JSX and are compared by the diff — use @ShouldUpdateOnPropsChange to control that. Move the ` +
          `decorator to the hook whose props these are, or drop it.`,
      );
    }

    // Read BEFORE defining: a symbol on a constructor is inherited through the class
    // chain, so this is the parent's list when there is one. Merging means a subclass
    // adds rather than shadows.
    const inherited = (ctor as unknown as { [STABLE_PROPS]?: readonly string[] })[STABLE_PROPS];
    const merged = inherited ? [...new Set([...inherited, ...keys])] : [...keys];

    Object.defineProperty(ctor, STABLE_PROPS, {
      value: merged,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  };
}

// --- Client-only DOM event listener decorators -----------------------------
// Built on the effect primitive: the listener is attached when effects run
// (client-only, after mount) and removed by the effect's cleanup on unmount.
// The decorated method is called with the event; `this` is the component.

type EventDecoratorTarget = EventTarget | null | undefined;

/**
 * The least an owner must be for a listener to hang off it: a runtime to attach
 * the effect to. A Hook has exactly this and no element — which is fine for
 * `window`/`document`, and is why the constraint is not "a component".
 */
type EventOwner = { [GLOBAL_RUNTIME]: Runtime };
/** An owner that also has an element of its own, which only @onElement needs. */
type ElementOwner = EventOwner & { [COMPONENT_RUNTIME]: ComponentRuntime };

/**
 * A known event name, or any other string.
 *
 * `(string & {})` is the trick that keeps BOTH: TypeScript still offers the
 * known names as completions, and an unknown one — a custom event, or a name the
 * lib's map has not caught up with — is accepted rather than being a type error.
 * Widening the parameter to plain `string` would silently drop the completions.
 */
type KnownEvent<EventMap> = Extract<keyof EventMap, string> | (string & {});

/**
 * The event a handler receives for the name it was registered with: `MouseEvent`
 * for "click", `KeyboardEvent` for "keydown". An unknown name falls back to
 * `Event`, which is all the DOM can promise about it.
 */
type EventFor<EventMap, Name> = Name extends keyof EventMap ? EventMap[Name] : Event;

/**
 * Each decorator's `This` is constrained by what its *target resolver* actually
 * reads, not by "component" across the board. @onWindow and @onDocument never
 * touch COMPONENT_RUNTIME, so requiring it only shut them out of Hooks for no
 * reason — while @onElement genuinely cannot work on one.
 *
 * `EventMap` is the second axis: each decorator listens on a different target,
 * and the DOM's own maps already say which events that target can deliver. Using
 * them means the handler's parameter is typed from the NAME, so
 * `@onElement("click") onClick(e: MouseEvent)` type-checks with no cast — the
 * `e as MouseEvent` that every handler used to open with was the type system
 * being told to look away.
 */
function createEventListenerDecorator<Owner extends EventOwner, EventMap>(
  decoratorName: string,
  resolveTarget: (owner: Owner) => EventDecoratorTarget,
  /**
   * Checked at construction, for a decorator whose owner is narrower than "anything with a
   * runtime" — today only `@onElement`. The TYPE already refuses a Hook; this is for the build
   * that has no types, which otherwise reached the resolver and died on a property of
   * `undefined`. See `onElement`.
   */
  validateOwner?: (owner: object) => void,
) {
  return <Name extends KnownEvent<EventMap>>(type: Name, options?: boolean | AddEventListenerOptions) => {
    if (__DEV__) {
      assertEventType(type, decoratorName);
    }

    return function <This extends Owner>(
      value: (this: This, event: EventFor<EventMap, Name>) => void,
      context: ClassMethodDecoratorContext<This, (this: This, event: EventFor<EventMap, Name>) => void>,
    ): void {
      if (__DEV__) {
        assertMethod(context.kind, decoratorName, context.name);
      }
      ensureStringContextName(context.name, decoratorName);

      context.addInitializer(function (this: This) {
        validateOwner?.(this);
        const component = this;
        // A dependency-free effect: runs once on mount (client only), cleans up
        // on unmount. No reactive reads → it never re-runs, so the listener is
        // attached exactly once.
        attachEffect(
          component,
          () => {
            const target = resolveTarget(component);
            if (!target) {
              if (__DEV__) {
                diagnose(
                  "RMD041",
                  `${component.constructor.name}.${decoratorName}.${type}`,
                  `@${decoratorName} found no target for its "${type}" listener.`,
                  { component: component.constructor.name, decorator: decoratorName, event: type },
                );
              }
              return;
            }

            if (__DEV__ && decoratorName === "onElement" && (target as Node).nodeName === HOST_TAG) {
              diagnose(
                "RMD042",
                `${component.constructor.name}.${type}`,
                `@onElement is listening for "${type}" on the default <ramonda-host>.`,
                { component: component.constructor.name, event: type },
              );
            }

            // The one cast, and it is confined here: addEventListener hands back
            // a plain `Event` at runtime, and no amount of typing changes what
            // the DOM delivers. The map decides what the HANDLER may assume; the
            // browser guarantees it for a name the map knows.
            const handler = (event: Event) => value.call(component, event as EventFor<EventMap, Name>);
            target.addEventListener(type, handler, options);
            return () => target.removeEventListener(type, handler, options);
          },
          false,
        );
      });
    };
  };
}

/**
 * Binds a listener on `window` for the owner's lifetime. Client only; works on a
 * Hook too.
 *
 *   @onWindow("resize") onResize(e: UIEvent) { … }
 */
export const onWindow = createEventListenerDecorator<EventOwner, WindowEventMap>("onWindow", () =>
  typeof window !== "undefined" ? window : null,
);

/**
 * Binds a listener on `document` for the owner's lifetime. Client only; works on
 * a Hook too.
 *
 *   @onDocument("keydown") onKey(e: KeyboardEvent) { … }
 */
export const onDocument = createEventListenerDecorator<EventOwner, DocumentEventMap>("onDocument", () =>
  typeof document !== "undefined" ? document : null,
);

/**
 * Binds a listener on the component's host element. Client only; components only
 * — a Hook has no element.
 *
 *   @onElement("click") onClick(e: MouseEvent) { … }
 */
export const onElement = createEventListenerDecorator<ElementOwner, HTMLElementEventMap>(
  "onElement",
  (component) => component[COMPONENT_RUNTIME].enhancedNode as EventDecoratorTarget,
  (owner) => {
    // A hook has no element, so the resolver above would read `.enhancedNode` of `undefined` and
    // die with "Cannot read properties of undefined" — an error naming nothing the author wrote.
    // Thrown in every build, and at construction rather than at mount, matching
    // `@ShouldUpdateOnPropsChange`: one rule for "this decorator is for components".
    if ((owner as { [COMPONENT_RUNTIME]?: ComponentRuntime })[COMPONENT_RUNTIME] === undefined) {
      throw new Error(
        `[Ramonda] @onElement is for components, not hooks. It binds a listener to the component's ` +
          `host element, and a hook has no element of its own. Move the listener to the component ` +
          `that uses <${owner.constructor.name} />, or use @onWindow / @onDocument, which work on both.`,
      );
    }
  },
);

// --- Client-only timer decorators ------------------------------------------
// Built on the effect primitive: the timer starts on mount (client only) and is
// cleared by the effect's cleanup on unmount. `this` is the component.

/**
 * Both timers are `createSubscriptionDecorator` with the timer as the
 * subscription: schedule on mount, clear on destroy. Written this way on purpose
 * — the public primitive has to be able to express the framework's own
 * decorators, or it is not general enough to hand out.
 *
 * `schedule` reads no signals, so the effect runs once and the timer is not
 * restarted by re-renders.
 */
function createTimerDecorator(decoratorName: string, schedule: (run: () => void, ms: number) => () => void) {
  return createSubscriptionDecorator<() => void, [ms: number]>(
    decoratorName,
    (_owner, run, ms) => schedule(run, ms),
    // At class-definition time, so `@interval("1s")` still throws where it is
    // written rather than on the first commit.
    (ms) => assertDelay(ms, decoratorName),
  );
}

/** Runs the method every `ms` for the component's lifetime. Client only. */
export const interval = createTimerDecorator("interval", (run, ms) => {
  const id = setInterval(run, ms);
  return () => clearInterval(id);
});

/** Runs the method once after `ms`, cancelled if unmounted first. Client only. */
export const timeout = createTimerDecorator("timeout", (run, ms) => {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
});

export function compute<T, R>(
  target: (this: T) => R,
  context: ClassMethodDecoratorContext<T, (this: T) => R> | ClassGetterDecoratorContext<T, R>,
) {
  if (__DEV__) {
    // On a FIELD this was silent: the initializer was treated as the getter
    // body, so `@compute value = 1` installed an accessor that recomputed `1`
    // and cached it. It works by accident until the field's initializer reads
    // anything at all.
    assertMethodOrGetter(context.kind, "compute", context.name);
  }

  const originalMethod = target;

  context.addInitializer(function (this: any) {
    const instance = this as { [GLOBAL_RUNTIME]: Runtime };
    const runtime = instance[GLOBAL_RUNTIME];
    const internalId = createId();

    const cache = {
      value: null as R | null,
      isDirty: true,
      deps: new Set<State<any>>(),
      // Called directly by State.get() while this compute is the tracker.
      addDep(s: State<any>) {
        this.deps.add(s);
      },
    };

    const invalidate = () => {
      cache.isDirty = true;
    };

    Object.defineProperty(this, context.name, {
      get() {
        if (cache.isDirty) {
          // Synchronously detach from the old State dependencies.
          for (const dep of cache.deps) {
            dep[detach](internalId);
          }
          cache.deps.clear();

          // Make this cache object the active tracker.
          const prevTracker = trackerContainer.current;
          trackerContainer.current = cache;

          // Name this compute as the active one, so a state write inside its
          // body can be reported against it (RMD018). Saved and restored like
          // the tracker, so a nested read unwinds back to the outer compute.
          const prevComputePhase = __DEV__ ? computePhase.label : undefined;
          if (__DEV__) {
            computePhase.label = `${
              (this as { constructor: { name: string } }).constructor.name
            }.${String(context.name)}`;
          }

          try {
            // Run the original getter — this is where cache.deps gets filled.
            cache.value = originalMethod.call(this);
            cache.isDirty = false;

            // RMD024: recomputing to the same answer, over and over, means the cache is doing
            // nothing — see computeChurn.ts for why neither RMD020 nor RMD022 can see it.
            if (__DEV__) recordCompute(this as object, String(context.name), cache.value);
          } finally {
            // Restore the previous tracker — it matters for nested @compute
            // reads, where an inner one would otherwise steal the outer's deps.
            trackerContainer.current = prevTracker;
            if (__DEV__) computePhase.label = prevComputePhase;
          }

          // Subscribe to the new dependencies synchronously, so a later write
          // can invalidate this cache.
          for (const dep of cache.deps) {
            dep[attach]({
              id: internalId,
              onChange: invalidate,
            });
          }
        }

        // Whatever this compute depends on, whoever is reading it depends on
        // too. Without this, a cache HIT touches no State at all, so the reader
        // records nothing and never invalidates: a @compute reading another
        // @compute returned a stale value forever. Runs on the hit path as well
        // as the miss path — the hit is exactly the broken case.
        //
        // Through `trackDependency` rather than the tracker directly, because a
        // reader can also be an EFFECT, and an effect reading a fresh compute
        // used to subscribe to nothing at all — the deps went to the tracker
        // scope, which an effect is not in.
        for (const dep of cache.deps) trackDependency(dep);

        return cache.value;
      },
      configurable: true,
      enumerable: true,
    });

    // Cleanup when the component is destroyed.
    runtime.clearReactives.push(() => {
      for (const dep of cache.deps) {
        dep[detach](internalId);
      }
      cache.deps.clear();
    });
  });
}
