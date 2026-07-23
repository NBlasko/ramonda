import { describe, test, expect } from "vitest";
import { Component, Hook, Host, state, create, destroy, effect } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { render, renderHook, act } from "../index";

interface CounterOptions {
  start: number;
}

class CounterHook extends Hook<CounterOptions> {
  @state count = 0;

  @create seed() {
    this.count = this.options.start;
  }

  increment() {
    this.count = this.count + 1;
  }
}

describe("renderHook", () => {
  test("mounts a hook on its own host and exposes the instance", () => {
    const result = renderHook(CounterHook, { initialOptions: { start: 2 } });

    expect(result.current.count).toBe(2);

    act(() => {
      result.current.increment();
    });

    expect(result.current.count).toBe(3);
  });

  test("the instance is stable across renders, unlike a function hook", () => {
    const result = renderHook(CounterHook, { initialOptions: { start: 0 } });
    const first = result.current;

    act(() => {
      result.current.increment();
    });

    // A Ramonda hook is constructed once by use() and lives as long as its
    // owner. `current` is the identity; the FIELDS are what change.
    expect(result.current).toBe(first);
  });

  test("rerender pushes new options through the same signals a parent would", () => {
    const seen: number[] = [];

    class Watching extends Hook<CounterOptions> {
      @effect track() {
        seen.push(this.options.start);
      }
    }

    const result = renderHook(Watching, { initialOptions: { start: 1 } });
    expect(seen).toEqual([1]);

    result.rerender({ start: 2 });

    // The effect re-ran because the OPTION signal changed — the same path a
    // re-rendering owner drives.
    expect(seen).toEqual([1, 2]);
  });

  test("unmount runs the hook's @destroy", () => {
    const log: string[] = [];

    class Owned extends Hook {
      @destroy bye() {
        log.push("destroyed");
      }
    }

    const result = renderHook(Owned);
    expect(log).toEqual([]);

    result.unmount();
    expect(log).toEqual(["destroyed"]);
  });

  test("a wrapper is mounted above the host, so context reaches the hook", () => {
    @Host("section")
    class Frame extends Component<{ children?: RamondaNode }> {
      render(): RamondaNode {
        return this.props.children;
      }
    }

    const result = renderHook(CounterHook, {
      initialOptions: { start: 4 },
      wrapper: Frame,
    });

    expect(result.container.querySelector("section")).toBeTruthy();
    // The host is nested inside the wrapper, and renderHook still found it.
    expect(result.current.count).toBe(4);
  });
});

describe("a hook tested through renderHook behaves the same in a real component", () => {
  test("same lifecycle, same values", () => {
    class Owner extends Component {
      counter = this.use(CounterHook, { start: 5 });
      render(): RamondaNode {
        return <p>{this.counter.count}</p>;
      }
    }

    const viaComponent = render<Owner>(<Owner />);
    const viaHarness = renderHook(CounterHook, { initialOptions: { start: 5 } });

    expect(viaComponent.instance.counter.count).toBe(viaHarness.current.count);

    act(() => {
      viaComponent.instance.counter.increment();
      viaHarness.current.increment();
    });

    expect(viaComponent.container.textContent).toBe("6");
    expect(viaHarness.current.count).toBe(6);
  });
});
