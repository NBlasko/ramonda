import type { Context, HookClassKind, DefaultProps, RenderableProps } from "../types/commonTypes";
import { displayName } from "../helpers/utils";
import type { BaseComponent, ComponentProps, RamondaNode } from "../types/vdom";
import type { BaseHook, HookMeta, HookProps, PropsFactory } from "../types/HookTypes";

import { useCommon } from "../helpers/common";
import { recordDefinition } from "../debug/sourceLocation";
import {
  COMPONENT_RUNTIME,
  type ComponentRuntime,
  createComponentRuntime,
  type Runtime,
  GLOBAL_RUNTIME,
} from "../core/runtime";
import { State } from "../reactivity/State";
import { reportPropWrite } from "../debug/renderPhase";
import { bindInstanceMethods } from "../helpers/bindMethods";

/**
 * Names the framework calls directly, so binding them would be paid for nothing.
 */
const lifecycles = new Set(["render"]);

// `render` is the one name the framework reserves, and it is a safe one to reserve: it is
// `abstract`, so TypeScript requires exactly one of it with exactly one
// signature. You cannot define it for some other purpose without the compiler
// objecting — the collision this list exists to prevent is not reachable. Moving
// it into a decorator would trade that compile-time guarantee for a runtime
// check, which is the wrong direction.

/** A constructor that hands back the object it is given, so a subclass's private field lands on that object. */
class OnTheGiven {
  constructor(given: object) {
    // biome-ignore lint/correctness/noConstructorReturn: returning `given` is the point — see `PropsTarget`.
    return given;
  }
}

/**
 * What a props proxy stands in front of: a PLAIN object, carrying the component it belongs to in a
 * private field.
 *
 * Plain, so it answers every reflection as `{}` did — `Object.keys`, `Reflect.ownKeys`, `in`, and its
 * prototype, `Object.prototype` — with no trap to say so. A trap cannot: once the props are frozen,
 * sealed or made non-extensible (a deep freeze, immer's auto-freeze), a proxy must report its target's
 * real prototype, and a class instance as the target with a trap answering `Object.prototype` threw a
 * `TypeError` there — measured. The private field is invisible to all of it, and `new PropsTarget({},
 * component)` puts it on the `{}` through `OnTheGiven`.
 */
class PropsTarget extends OnTheGiven {
  readonly #component: Component<ComponentProps>;
  constructor(given: object, component: Component<ComponentProps>) {
    super(given);
    this.#component = component;
  }
  static componentOf(target: object): Component<ComponentProps> {
    return (target as PropsTarget).#component;
  }
}

/**
 * One handler for every props proxy: each trap reads the component off the proxy's target.
 *
 * A handler written per component held two closures and the scope they shared — measured in Chrome
 * after creating 1,000 rows of five components, about 100 B and four allocations per component, for
 * code that was the same every time.
 */
const propsHandler: ProxyHandler<object> = {
  get(target, key: string | symbol) {
    const component = PropsTarget.componentOf(target);
    if (typeof key === "symbol") {
      return component[COMPONENT_RUNTIME].rawProps[key];
    }
    const componentRuntime = component[COMPONENT_RUNTIME];

    let sig = componentRuntime.propsSignals[key];
    if (!sig) {
      const value = componentRuntime.rawProps[key];
      const runtime = component[GLOBAL_RUNTIME];
      sig = State.heardBy(value, runtime.id, runtime);
      componentRuntime.propsSignals[key] = sig;
    }

    return sig.get();
  },
  set(target, key: string | symbol) {
    const component = PropsTarget.componentOf(target);
    // Props are read-only: the getter always reads rawProps, so a write here
    // has nothing to write to and used to be swallowed silently.
    //
    // Throws in every build, matching a hook's props (RMD015) — the two are the
    // same mistake and behaved differently for no reason a user could see.
    // This is enforcement, not diagnostics: it lives OUTSIDE `if (__DEV__)` so
    // behaviour cannot differ between builds, while the DEV diagnostic below
    // only explains it. Throwing rather than returning false, because a false
    // return throws only in strict mode.
    if (__DEV__) {
      reportPropWrite(component, String(key));
    }
    throw new TypeError(
      `[RMD004] Cannot assign to \`props.${String(key)}\` in <${displayName(
        component,
      )} /> — props are read-only and owned by the parent. Copy the value into @state, or call a callback prop to ask the parent to change it.`,
    );
  },
};

function createPropsProxy<P extends ComponentProps>(component: Component<P>): RenderableProps<P> {
  return new Proxy(
    new PropsTarget({}, component as unknown as Component<ComponentProps>),
    propsHandler,
  ) as unknown as RenderableProps<P>;
}

export abstract class Component<P extends ComponentProps = DefaultProps> implements BaseComponent<P> {
  public static readonly __isComponent = true;
  public props: RenderableProps<P>;
  public [GLOBAL_RUNTIME]: Runtime;
  public [COMPONENT_RUNTIME]: ComponentRuntime;
  constructor(props: P, context: Context) {
    // First, and before anything else on the stack: the frame for `new <Subclass>` is what says
    // where this component is defined, and it is only there while the constructor chain is running.
    if (__DEV__) recordDefinition(this);

    this.props = createPropsProxy(this);
    bindInstanceMethods(this, Component.prototype, lifecycles);
    // One object under both names — see `createComponentRuntime`.
    const runtime = createComponentRuntime(this, context, props);
    this[GLOBAL_RUNTIME] = runtime;
    this[COMPONENT_RUNTIME] = runtime;
  }

  /**
   * A hook, optionally with props, optionally with metadata ABOUT this use.
   *
   * The third argument is not passed to the hook; it is what a `use()` says about the hook to the
   * tools looking at it — see `HookMeta`. Separate from the props because a hook's props belong to
   * whoever wrote it, and a framework word reserved in there collides with a real one eventually.
   *
   * ```tsx
   * private signup = this.use(Form<typeof schema>, () => ({ schema, defaultValues, onSubmit }), { label: "Sign Up" });
   * private timer = this.use(Poll, undefined, { label: "prices" });
   * ```
   *
   * Props are a CALLBACK, never an object — an object literal is evaluated once, while this owner
   * is constructed, so it can only ever carry what was true then (RMD055). A callback that reads no
   * signal is called once too, so nothing is paid for saying it this way.
   *
   * A propless hook needs the `undefined` placeholder, and that is deliberate: a second overload
   * taking metadata in the props position would be ambiguous, since `{ label: "…" }` is a perfectly
   * good props bag for some hook somewhere.
   */
  protected use<T extends BaseHook<undefined>>(
    hook: HookClassKind<T, undefined>,
    props?: undefined,
    meta?: HookMeta,
  ): T;
  protected use<T extends BaseHook<Q>, Q extends HookProps, S extends this = this>(
    hook: HookClassKind<T, Q>,
    props: PropsFactory<Q, S>,
    meta?: HookMeta,
  ): T;
  protected use<T extends BaseHook<Q>, Q extends HookProps>(
    hook: HookClassKind<T, Q>,
    props?: PropsFactory<Q, never>,
    meta?: HookMeta,
  ): T {
    return useCommon(this, hook, props, meta);
  }

  public abstract render(): RamondaNode;
}
