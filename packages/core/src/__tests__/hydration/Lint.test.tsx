import { describe, test, expect, vi } from "vitest";
import { state, persist, create } from "../../base/decorators";
import { Component } from "../../base/Component";
import { renderToString } from "../../hydration/ssr";

function loggedDuringCreateMount(calls: unknown[][], needle = "during create/mount"): boolean {
  return calls.some((c) => c.some((a) => typeof a === "string" && a.includes(needle)));
}

describe("hydration: unpersisted-state lint (DEV, server)", () => {
  test("warns about a plain prop set in create/mount", async () => {
    class Leaky extends Component {
      @create init() {
        (this as unknown as { cache: string }).cache = "computed";
      }
      render() {
        return <div>x</div>;
      }
    }

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await renderToString(<Leaky />);
    const calls = spy.mock.calls;
    spy.mockRestore();

    expect(
      calls.some((c) => c.some((a) => typeof a === "string" && a.includes('"cache"') && a.includes("hydration"))),
    ).toBe(true);
  });

  test("no warning when the value is @persist", async () => {
    class Safe extends Component {
      @persist cache = "";
      @create init() {
        this.cache = "computed";
      }
      render() {
        return <div>x</div>;
      }
    }

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await renderToString(<Safe />);
    const calls = spy.mock.calls;
    spy.mockRestore();

    expect(loggedDuringCreateMount(calls)).toBe(false);
  });

  test("no warning for @state set in create/mount", async () => {
    class OkState extends Component {
      @state n = 0;
      @create init() {
        this.n = 5;
      }
      render() {
        return <div>{this.n}</div>;
      }
    }

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await renderToString(<OkState />);
    const calls = spy.mock.calls;
    spy.mockRestore();

    expect(loggedDuringCreateMount(calls)).toBe(false);
  });
});
