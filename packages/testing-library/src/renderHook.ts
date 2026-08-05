import { Component, __h, state } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { act } from "./act";
import { render, type WrapperComponent } from "./render";

/**
 * A hook class as `use()` takes it.
 *
 * Structural rather than `typeof Hook`: core's `HookClassKind` and `HookProps`
 * are internal types, and constraining to `Hook<O>` would need them. Written
 * this way, `O` is inferred from the constructor's own props parameter — so
 * `renderHook(CounterHook)` knows both the hook's type and its props bag with
 * nothing declared at the call site.
 *
 * `runtime: never` because a caller never supplies it: `use()` passes the
 * owner's runtime, and constructor parameters are bivariant, so any runtime type
 * still matches.
 */
type HookClass<T, O> = new (runtime: never, props: O) => T;

export interface RenderHookProps<O> {
  /** The props bag the hook is first given, as a caller's `use()` would pass it. */
  initialProps?: O;
  /** A component to mount the host inside — a context provider, for instance. */
  wrapper?: WrapperComponent;
}

export interface RenderHookResult<T, O> {
  /**
   * The hook instance.
   *
   * Unlike a function-hook library, this does NOT change between renders:
   * a Ramonda hook is constructed once by `use()` and lives as long as its
   * owner, so `result.current` is the same object throughout. Read a field off
   * it to see the current value — the instance is the identity, the fields are
   * the state.
   */
  current: T;
  /** Replaces the props the hook was given, the way a re-rendering owner would. */
  rerender(props?: O): void;
  /** Destroys the host component, so the hook's `@destroy` and cleanups run. */
  unmount(): void;
  /** The host component's container, for the rare hook that touches the DOM. */
  container: HTMLElement;
}

/**
 * Mounts a hook on its own throwaway component, so it can be tested without one.
 *
 * ```ts
 * const { current, rerender } = renderHook(useCounter, { initialProps: { start: 2 } });
 * expect(current.count).toBe(2);
 *
 * act(() => { current.increment(); });
 * expect(current.count).toBe(3);
 * ```
 *
 * A Ramonda hook cannot stand alone — `use()` gives it its owner's runtime, and
 * that runtime is what its lifecycle, effects and prop signals hang off. So
 * this really does mount a component; there is no lighter way that still
 * exercises the same machinery, and a lighter way that did not would be testing
 * something other than what ships.
 *
 * **`rerender(props)` is the interesting one.** Props reach a hook through
 * signals owned by the CALLER, updated when the caller re-renders. Passing new
 * props here drives that same path, so `@watchProp`-style reactions and
 * anything reading `this.props` behave exactly as they would under a real
 * parent.
 */
export function renderHook<T, O = undefined>(
  hook: HookClass<T, O>,
  options: RenderHookProps<O> = {},
): RenderHookResult<T, O> {
  const initialProps = options.initialProps;

  class HookHost extends Component {
    // Declared before `instance` on purpose: field initializers run top to
    // bottom, and `use()` reads this one immediately to build the first props
    // bag. Reversed, the hook would be constructed against `undefined`.
    @state currentProps: O | undefined = initialProps;

    instance = this.use(hook as never, (self: HookHost) => self.currentProps as never) as T;

    render(): RamondaNode {
      // A hook has no DOM of its own; the host still needs one element, because
      // every component in Ramonda is exactly one element.
      return __h("div", { "data-ramonda-hook-host": "" }) as RamondaNode;
    }
  }

  const result = render<HookHost>(__h(HookHost, null), {
    wrapper: options.wrapper,
  });

  // With a wrapper, the root instance is the WRAPPER — the host is inside it.
  const host = (result.instance instanceof HookHost ? result.instance : findHost(result.container)) as HookHost;

  return {
    get current() {
      return host.instance;
    },
    rerender(next?: O) {
      act(() => {
        host.currentProps = next;
      });
    },
    unmount: result.unmount,
    container: result.container,
  };

  function findHost(container: HTMLElement): HookHost {
    const marked = container.querySelector("[data-ramonda-hook-host]");
    // The host's own element is the ramonda-host ABOVE the marked div — walk up
    // to whichever node carries the instance.
    let node: Node | null = marked;
    while (node) {
      const instance = (node as { _componentInstance?: unknown })._componentInstance;
      if (instance instanceof HookHost) return instance;
      node = node.parentNode;
    }
    throw new Error(
      "[Ramonda] renderHook could not find its host component. This is a bug in @ramonda/testing-library.",
    );
  }
}
