import type { Context, HookClassKind, DefaultProps, RenderableProps } from "../types/commonTypes";
import type { BaseComponent, ComponentProps, RamondaNode } from "../types/vdom";
import type { BaseHook, HookMeta, HookProps, PropsFactory } from "../types/HookTypes";

import { useCommon } from "../helpers/common";
import { recordDefinition } from "../debug/sourceLocation";
import {
  COMPONENT_RUNTIME,
  type ComponentRuntime,
  createComponentRuntime,
  createRuntime,
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

// A prop-update gate used to be a method the framework looked up BY NAME, which
// meant the name was reserved on every component whether or not the author knew it.
// It is now the `@ShouldUpdateOnPropsChange` decorator, so the method can be called
// anything and a class that happens to define a method by that name for its own
// reasons is just a class with a method.
//
// `render` is the one name still reserved, and it is a different case: it is
// `abstract`, so TypeScript requires exactly one of it with exactly one
// signature. You cannot define it for some other purpose without the compiler
// objecting — the collision this list exists to prevent is not reachable. Moving
// it into a decorator would trade that compile-time guarantee for a runtime
// check, which is the wrong direction.
function createPropsProxy<P extends ComponentProps>(component: Component<P>) {
  return new Proxy({} as RenderableProps<P>, {
    get: (_, key: string | symbol) => {
      if (typeof key === "symbol") {
        return (component[COMPONENT_RUNTIME].rawProps as any)[key];
      }
      const componentRuntime = component[COMPONENT_RUNTIME];

      let sig = componentRuntime.propsSignals.get(key);
      if (!sig) {
        const value = (componentRuntime.rawProps as any)[key];
        const runtime = component[GLOBAL_RUNTIME];
        sig = new State(value, {
          listener: {
            id: runtime.id,
            onChange: runtime.reBuild,
          },
        });
        componentRuntime.propsSignals.set(key, sig);
      }

      return sig.get();
    },
    set: (_, key: string | symbol) => {
      // Props are read-only: the getter always reads rawProps, so a write here
      // has nothing to write to and used to be swallowed silently.
      //
      // Throws in every build, matching Hook options (RMD015) — the two are the
      // same mistake and behaved differently for no reason a user could see.
      // This is enforcement, not diagnostics: it lives OUTSIDE `if (__DEV__)` so
      // behaviour cannot differ between builds, while the DEV diagnostic below
      // only explains it. Throwing rather than returning false, because a false
      // return throws only in strict mode.
      if (__DEV__) {
        reportPropWrite(component, String(key));
      }
      throw new TypeError(
        `[RMD004] Cannot assign to \`props.${String(key)}\` in <${
          component.constructor.name
        } /> — props are read-only and owned by the parent. Copy the value into @state, or call a callback prop to ask the parent to change it.`,
      );
    },
  });
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
    this[GLOBAL_RUNTIME] = createRuntime(this, context);
    this[COMPONENT_RUNTIME] = createComponentRuntime(props);
  }

  /**
   * A hook, optionally with props, optionally with metadata ABOUT this use.
   *
   * The third argument is not passed to the hook; it is what a `use()` says about the hook to the
   * tools looking at it — see `HookMeta`. Separate from the props because a hook's props belong to
   * whoever wrote it, and a framework word reserved in there collides with a real one eventually.
   *
   * ```tsx
   * private signup = this.use(Form<typeof schema>, { schema, defaultValues, onSubmit }, { label: "Sign Up" });
   * private timer = this.use(Poll, undefined, { label: "prices" });
   * ```
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
  protected use<T extends BaseHook<Q>, Q extends HookProps>(hook: HookClassKind<T, Q>, props: Q, meta?: HookMeta): T;
  protected use<T extends BaseHook<Q>, Q extends HookProps>(
    hook: HookClassKind<T, Q>,
    props?: Q | PropsFactory<Q, never>,
    meta?: HookMeta,
  ): T {
    return useCommon(this, hook, props, meta);
  }

  public abstract render(): RamondaNode;
}
