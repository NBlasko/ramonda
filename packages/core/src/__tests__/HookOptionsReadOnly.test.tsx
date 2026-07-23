import { describe, test, expect, beforeEach } from "vitest";
import { Component, Hook, bootstrap, unmount } from "../index";
import type { VNode } from "../types/vdom";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * A hook's options are owned by whoever called `this.use(...)`. The proxy serves
 * them from the owner's signals on every read, so an assignment has nothing to
 * write to — and before RMD015 it landed on the empty proxy target and vanished:
 * no error, and reading the key back still returned the old value.
 *
 * RMD015 throws in every build, exactly like a write to a component's props
 * (RMD004) — one rule for read-only inputs. See the note in createOptionsProxy.
 */

interface SizeOptions {
  width: number;
}

class SizeHook extends Hook<SizeOptions> {
  get width(): number {
    return this.options.width;
  }
  /** The mistake this diagnostic is about. */
  tryToResize(): void {
    (this.options as SizeOptions).width = 999;
  }
}

let hook: SizeHook;

class Panel extends Component {
  size = this.use(SizeHook, { width: 10 });
  render() {
    hook = this.size;
    return <div id="panel">{String(this.size.width)}</div>;
  }
}

function withApp(body: (container: HTMLElement) => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  bootstrap((<Panel />) as VNode, container);
  try {
    body(container);
  } finally {
    unmount(container);
    container.remove();
  }
}

beforeEach(() => {
  resetDiagnostics();
});

describe("hook options are read-only (RMD015)", () => {
  test("assigning to an option throws instead of vanishing", () => {
    withApp(() => {
      expect(() => hook.tryToResize()).toThrow(/RMD015/);
    });
  });

  test("the option keeps the owner's value after a rejected write", () => {
    withApp((container) => {
      expect(() => hook.tryToResize()).toThrow();
      expect(hook.width).toBe(10);
      expect(container.querySelector("#panel")!.textContent).toBe("10");
    });
  });

  test("the thrown message names the hook and the property", () => {
    withApp(() => {
      expect(() => hook.tryToResize()).toThrow(/SizeHook/);
      expect(() => hook.tryToResize()).toThrow(/options\.width/);
    });
  });

  /**
   * CONTROL. Reproduces the pre-fix proxy — get trap only — to show the failure
   * really was silent, so the tests above are measuring a fix rather than
   * restating how proxies work. Without this, a passing suite proves nothing
   * about what the trap changed.
   */
  test("CONTROL: without a set trap the write is swallowed", () => {
    const store: Record<string, unknown> = { width: 10 };
    const optionsWithoutTrap = new Proxy({}, { get: (_, key: string) => store[key] }) as { width: number };

    expect(() => {
      optionsWithoutTrap.width = 999;
    }).not.toThrow();
    expect(optionsWithoutTrap.width).toBe(10); // the write left no trace
  });
});
