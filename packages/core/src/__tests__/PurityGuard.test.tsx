import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { compute, memoized, state } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";
import { installPurityGuard } from "../debug/purityGuard";

/**
 * RMD021 — randomness generated while a render, a `@compute` or a `@memoized`
 * builder is running.
 *
 * It watches the CALL rather than the value, which is what makes it catch things
 * RMD020's double render cannot: a value that happens to come out the same twice.
 *
 * Randomness only, and that is the finding rather than the design: a clock guard was
 * written first and reported things the app never did — an `Event` constructor stamps
 * `timeStamp`, which under jsdom is a JS-visible `Date.now()`, so any diagnostic
 * raised during a render tripped it. Nothing in the platform generates randomness
 * behind your back, so this half of the check can be trusted.
 */

let logs: string[] = [];

beforeEach(() => {
  resetDiagnostics();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function reported(): string {
  return logs.join("\n");
}

describe("RMD021", () => {
  test("Math.random() in a render is reported, and the component is named", async () => {
    class Dice extends Component {
      render() {
        return <span>{String(Math.random())}</span>;
      }
    }

    await getDOM<Dice>(<Dice />);

    expect(reported()).toContain("RMD021");
    expect(reported()).toContain("<Dice /> called Math.random() while rendering");
  });

  test("crypto.randomUUID() in a render is reported", async () => {
    class Ids extends Component {
      render() {
        return <span data-id={crypto.randomUUID()}>row</span>;
      }
    }

    await getDOM<Ids>(<Ids />);
    expect(reported()).toContain("crypto.randomUUID()");
  });

  test("in a @compute the message says the value is frozen", async () => {
    class Panel extends Component {
      @compute get token() {
        return Math.random();
      }

      render() {
        return <span>{String(this.token)}</span>;
      }
    }

    await getDOM<Panel>(<Panel />);

    // A compute caches, so this is the quieter failure: not a mismatch, a value stuck
    // at the moment it was first asked for.
    expect(reported()).toContain("while computing");
    expect(reported()).toContain("frozen");
    expect(reported()).toContain("Panel.token");
  });

  test("in a @memoized builder it is attributed to the builder, not the render", async () => {
    class Row extends Component {
      @state picked = "";

      @memoized
      choose(id: string) {
        // Read while BUILDING, so it is cached with the handler — every click uses
        // this one value.
        const nonce = Math.random();
        return () => {
          this.picked = `${id}:${nonce}`;
        };
      }

      render() {
        return <button type="button" onclick={this.choose("a")} />;
      }
    }

    await getDOM<Row>(<Row />);

    expect(reported()).toContain("while building a memoised member");
    expect(reported()).toContain("Row.choose");
    // The builder is CALLED from the render, so without its own phase marker the
    // report would have named the render and pointed at the wrong fix.
    expect(reported()).not.toContain("while rendering");
  });

  test("in a hook's props callback it is attributed to the bag", async () => {
    class Reader extends Hook<{ token: string }> {
      get seen(): string {
        return this.props.token;
      }
    }

    class Panel extends Component {
      reader = this.use(Reader, () => ({ token: crypto.randomUUID() }));

      render() {
        return <span>{this.reader.seen}</span>;
      }
    }

    await getDOM<Panel>(<Panel />);

    /**
     * The strangest of the four consequences, and the reason the callback does not need to run
     * twice to be caught: the callback is cached on the signals it reads, and a random value is
     * not one of them, so it is frozen into the bag until something unrelated invalidates the
     * callback and then it jumps. As a query key, an entry that moves on somebody else's state
     * change and never on this one's.
     */
    expect(reported()).toContain("while building a hook's props");
    expect(reported()).toContain("Panel → Reader");
    expect(reported()).not.toContain("while rendering");
  });

  test("outside a pure phase it says nothing", async () => {
    class Panel extends Component {
      @state token = "";

      pick() {
        // An event handler is exactly where randomness belongs.
        this.token = String(Math.random());
      }

      render() {
        return (
          <button type="button" onclick={this.pick}>
            {this.token || "pick"}
          </button>
        );
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.pick();
    await settle();

    expect(reported()).not.toContain("RMD021");
  });

  test("the framework's own reporting does not report itself", async () => {
    /**
     * The regression that killed the first version of this check. `ramondaLog` builds
     * a log entry with an id, and it dispatches a `CustomEvent` for the devtools log
     * stream — so raising ANY diagnostic during a render used to generate randomness
     * (and, when the clock was patched too, read a clock) inside the guard's own
     * window. Three of core's diagnostic tests failed with RMD021 instead of the code
     * they were asserting.
     */
    class Bad extends Component {
      @state count = 0;

      render() {
        // RMD001: a state write during render.
        this.count = this.count + 1;
        return <span>{String(this.count)}</span>;
      }
    }

    await getDOM<Bad>(<Bad />);

    expect(reported()).toContain("RMD001");
    expect(reported()).not.toContain("RMD021");
  });

  test("Date.now() in a render is NOT reported — the gap, stated on purpose", async () => {
    class Clock extends Component {
      render() {
        return <span>{String(Date.now())}</span>;
      }
    }

    await getDOM<Clock>(<Clock />);

    /**
     * Deliberate. A patched clock catches the platform's reads too — an `Event`
     * constructor stamps `timeStamp` — and under jsdom, where every app runs its own
     * tests, that means false reports attributed to whatever was rendering.
     *
     * What covers it instead: `new Date()` is caught by RMD020 every time (a fresh
     * object has a fresh identity), and `Date.now()` in a server-rendered app is
     * caught by RMD007 when the hydration disagrees. In a client-only app, rendered
     * into the output, nothing catches it.
     */
    expect(reported()).not.toContain("RMD021");
  });
});

/**
 * What `installPurityGuard` promises, as opposed to what it reports.
 *
 * Every test above asks whether a diagnostic comes out. None asked whether the PATCHED FUNCTIONS
 * STILL WORK — and they replace `Math.random` and two `crypto` methods for the whole life of a
 * development build, so a patch that dropped a return value or lost its `this` would break every
 * app that runs in dev. The union of both coverage runs put this file's three install branches
 * among the thinnest in the package, which is what sent me here.
 *
 * All three turned out to be correct. Nothing below is a fix; it is the proof, and from here on it
 * is a regression test.
 */
describe("installing the purity guard", () => {
  /**
   * The patch is a wrapper, so everything about the call has to survive it: the value, the range,
   * the `this` a destructured reference does NOT bring, and — for `getRandomValues` — the array it
   * is handed, which it fills in place and returns.
   */
  test("the patched functions still do what they did", () => {
    const values = new Set<number>();
    for (let i = 0; i < 1000; i++) values.add(Math.random());
    // 1000 distinct values out of 1000 draws, measured. A wrapper that returned a constant, or the
    // wrapper itself rather than the result, would fail here rather than in somebody's app.
    expect(values.size).toBeGreaterThan(990);
    expect([...values].every((value) => value >= 0 && value < 1)).toBe(true);

    // Destructured, so there is no receiver at the call. This asserts less than it looks like it
    // does, and the plant is why: replacing `.apply(this, args)` with `.apply(host, args)` passes
    // every test here, because for all three patched functions the host IS the natural receiver —
    // `Math.random.apply(Math)` and `.apply(undefined)` answer the same. So what this pins is that
    // a call with no receiver works at all, not that the receiver is forwarded.
    const { random } = Math;
    expect(typeof random()).toBe("number");

    expect(crypto.randomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const array = new Uint8Array(16);
    // The SAME array back, and filled: `getRandomValues` writes in place, so a wrapper that
    // returned a copy would satisfy a caller reading the return and betray one reading the argument.
    expect(crypto.getRandomValues(array)).toBe(array);
    expect(array.every((byte) => byte === 0)).toBe(false);
  });

  /** "Safe to call more than once", which `index.ts` relies on and nothing checked. */
  test("installing again does not wrap the wrapper", () => {
    const patched = Math.random;
    installPurityGuard();
    expect(Math.random).toBe(patched);
  });

  /**
   * With no `crypto` at all, the check does not give up on `Math.random`.
   *
   * A fresh copy of the module is needed because `installed` is module state — the copy this suite
   * imported was patched when `index.ts` loaded. `globalThis.crypto` is a configurable GETTER here,
   * so it is deleted and put back by descriptor; and the fresh module patches `Math.random` a
   * second time, over the live one, which has to be undone or every later test reports twice.
   */
  test("with no crypto, Math.random is still patched", async () => {
    const savedCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    const livePatch = Math.random;
    vi.resetModules();
    const fresh = await import("../debug/purityGuard");

    try {
      Reflect.deleteProperty(globalThis, "crypto");
      expect(typeof (globalThis as { crypto?: unknown }).crypto).toBe("undefined");

      fresh.installPurityGuard();

      // It reached `Math.random` before it reached the `crypto` question — the one that matters most
      // is the one every app calls.
      expect(Math.random).not.toBe(livePatch);
      expect(typeof Math.random()).toBe("number");
    } finally {
      if (savedCrypto) Object.defineProperty(globalThis, "crypto", savedCrypto);
      Math.random = livePatch;
    }
  });

  /**
   * A `crypto` that has `getRandomValues` and NOT `randomUUID`, which is a real platform rather
   * than a contrivance: `randomUUID` exists only in a secure context, so an app served over plain
   * `http://` from anything but localhost has exactly this object.
   *
   * The guard must patch what is there and **must not define what is not.** Adding
   * `crypto.randomUUID` would hand a feature detection — `if (crypto.randomUUID)` — a function
   * whose native is `undefined`, so the app would call it and crash in development only.
   */
  test("a partial crypto is patched where it can be, and nothing is added to it", async () => {
    const savedCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    const livePatch = Math.random;
    const native = (array: Uint8Array) => array;
    const partial: { getRandomValues: typeof native; randomUUID?: unknown } = { getRandomValues: native };
    vi.resetModules();
    const fresh = await import("../debug/purityGuard");

    try {
      Object.defineProperty(globalThis, "crypto", { value: partial, configurable: true, writable: true });

      fresh.installPurityGuard();

      expect(partial.getRandomValues).not.toBe(native);
      expect("randomUUID" in partial).toBe(false);
    } finally {
      if (savedCrypto) Object.defineProperty(globalThis, "crypto", savedCrypto);
      Math.random = livePatch;
    }
  });
});
