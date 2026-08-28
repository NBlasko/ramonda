import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../base/Component";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * `@state` is serialized into the hydration blob as JSON, so a value JSON cannot
 * represent — a function, symbol or bigint — is lost on the way to the client.
 * RMD019 catches it at the assignment, in DEV, on the client too (not only during
 * a server render, which is where the SSR serializer's own late check runs).
 */

function captureCodes() {
  const codes: string[] = [];
  const handler = (e: Event) => {
    const m = ((e as CustomEvent).detail as { message?: string })?.message?.match(/^\[(RMD\d+)\]/);
    if (m) codes.push(m[1]);
  };
  window.addEventListener("ramonda:dev-log", handler);
  return { codes, stop: () => window.removeEventListener("ramonda:dev-log", handler) };
}

let cap: ReturnType<typeof captureCodes>;
beforeEach(() => {
  resetDiagnostics();
  vi.spyOn(console, "error").mockImplementation(() => {});
  cap = captureCodes();
});
afterEach(() => {
  cap.stop();
  vi.restoreAllMocks();
});

describe("RMD019: @state that cannot be serialized", () => {
  test("a field initialized to a function is flagged (the constructor case)", async () => {
    class Bad extends Component {
      @state fn = () => 1;
      render() {
        return (
          <div>
            <p>x</p>
          </div>
        );
      }
    }

    await getDOM(<Bad />);
    expect(cap.codes).toContain("RMD019");
  });

  test("assigning a function to @state later is flagged (the set case)", async () => {
    class C extends Component {
      @state val: unknown = 0;
      render() {
        return (
          <div>
            <p>{String(this.val)}</p>
          </div>
        );
      }
    }

    const { instance, settle } = await getDOM<C>(<C />);
    expect(cap.codes).not.toContain("RMD019"); // 0 is fine

    (instance as unknown as { val: unknown }).val = () => 2;
    await settle();
    expect(cap.codes).toContain("RMD019");
  });

  test("a bigint in state is flagged too", async () => {
    class Big extends Component {
      @state n = 10n;
      render() {
        return (
          <div>
            <p>x</p>
          </div>
        );
      }
    }

    await getDOM(<Big />);
    expect(cap.codes).toContain("RMD019");
  });

  test("ordinary serializable state — numbers, strings, arrays, objects — is silent", async () => {
    class Ok extends Component {
      @state n = 0;
      @state name = "a";
      @state list = [1, 2, 3];
      @state obj = { a: 1, nested: { b: 2 } };
      render() {
        return (
          <div>
            <p>{this.n}</p>
          </div>
        );
      }
    }

    await getDOM(<Ok />);
    expect(cap.codes).not.toContain("RMD019");
  });

  test("a callback PROP is not @state, so it is never flagged", async () => {
    class Child extends Component<{ onDo: () => void }> {
      render() {
        return (
          <div>
            <button onclick={this.props.onDo}>x</button>
          </div>
        );
      }
    }

    class Parent extends Component {
      render() {
        return (
          <div>
            <Child onDo={() => {}} />
          </div>
        );
      }
    }

    await getDOM(<Parent />);
    expect(cap.codes).not.toContain("RMD019");
  });
});
