import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Component } from "../../base/Component";
import { Hook } from "../../base/Hook";
import { Host, state, deferHydration, memoized } from "../../base/decorators";
import { hydrateRoot } from "../../hydration/hydrate";
import { renderToString } from "../../hydration/ssr";
import { bootstrap, unmount } from "../../index";
import { flushSync, getComponentInstance } from "../../testing";
import { queueAfterCommit, flushAfterCommit } from "../../core/commit";
import { resetFaults } from "../../debug/fault";

/**
 * What a PRODUCTION build reports, and to whom.
 *
 * Every `diagnose()` call is behind `if (__DEV__)`, so a production build has always emitted
 * nothing at all. That is right for most of what it catches — a mistake in code fires on the first
 * render, on the machine of whoever made it — and wrong for the few faults that need the world to
 * go wrong before they happen. Those cannot be found before shipping, and until now nothing said a
 * word about them afterwards either.
 *
 * The two here are of that kind. RMD017 needs a dynamic import that neither settles nor rejects.
 * RMD047 needs a build whose affected path nobody ran, and then degrades quietly for the life of
 * the page. Both are asserted through the collector protocol rather than through the console,
 * because the console is the half that stays in development.
 *
 * See `vitest.prod.config.ts` for why this is a separate process.
 */

interface Captured {
  records: RamondaDiagnostic[];
  stop: () => void;
}

function collect(): Captured {
  const records: RamondaDiagnostic[] = [];
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
  return { records, stop: () => (globalThis.__RAMONDA_DIAGNOSTICS__ = undefined) };
}

async function serverHtmlInto(vnode: Parameters<typeof renderToString>[0]): Promise<HTMLElement> {
  const html = await renderToString(vnode);
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.innerHTML = html;
  return container;
}

@Host("div")
class Stuck extends Component {
  @deferHydration wait() {
    return new Promise<void>(() => {
      /* never settles — the fault being reported */
    });
  }
  render() {
    return <p>stuck</p>;
  }
}

@Host("div")
class Panel extends Component {
  @state label = "one";

  @memoized
  pick(id: unknown) {
    return () => id;
  }

  render() {
    // An object cannot be part of a cache key. Development throws on this; production degrades.
    const bad = this.pick({ id: 7 } as unknown as string);
    return (
      <button type="button" onclick={bad}>
        {this.label}
      </button>
    );
  }
}

let captured: Captured | undefined;

beforeEach(() => {
  resetFaults();
});

afterEach(() => {
  captured?.stop();
  captured = undefined;
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
});

describe("production diagnostics", () => {
  // Without this the whole file would be asserting the development paths under another name.
  test("__DEV__ is false in this run", () => {
    expect(__DEV__).toBe(false);
  });

  test("a handler key that cannot be built is reported", () => {
    captured = collect();

    const container = document.createElement("div");
    document.body.appendChild(container);
    bootstrap(<Panel />, container);
    flushSync();

    const record = captured.records.find((r) => r.code === "RMD047");
    expect(record).toBeDefined();
    expect(record!.scope).toBe("ramonda/core");
    expect(record!.severity).toBe("error");
    expect(record!.dedupKey).toContain("RMD047:");
    expect(typeof record!.time).toBe("number");

    unmount(container);
    container.remove();
  });

  /**
   * The half that must NOT ship.
   *
   * `fix` is the prose, and it lives in `SPECS` — by a distance the largest strippable thing in the
   * package. A production record carrying one would mean the table survived the build, which is the
   * cost this whole arrangement exists to avoid. Asserting its absence is how that stays true.
   */
  test("the record carries what happened and not how to fix it", () => {
    captured = collect();

    const container = document.createElement("div");
    document.body.appendChild(container);
    bootstrap(<Panel />, container);
    flushSync();

    const record = captured.records.find((r) => r.code === "RMD047")!;
    expect(record.fix).toBeUndefined();
    expect(record.data).toBeUndefined();
    expect(record.message).not.toContain("Pass the primitive");

    unmount(container);
    container.remove();
  });

  test("it reports once, however many times the fault repeats", () => {
    captured = collect();

    const container = document.createElement("div");
    document.body.appendChild(container);
    bootstrap(<Panel />, container);
    flushSync();

    // Every re-render calls the un-keyable handler again. A record per render would be a log
    // nobody can read and a bill nobody expected.
    const instance = getComponentInstance(container.firstElementChild) as unknown as Panel;
    for (let i = 0; i < 5; i++) {
      instance.label = `n${i}`;
      flushSync();
    }

    // The renders have to have HAPPENED, or the dedup below is asserting nothing.
    expect(container.querySelector("button")!.textContent).toBe("n4");
    expect(captured.records.filter((r) => r.code === "RMD047")).toHaveLength(1);

    unmount(container);
    container.remove();
  });

  /**
   * No collector, no record, no cost.
   *
   * This is what makes the whole thing opt-in without a flag to document: an app that installs
   * nothing behaves exactly as it did before any of this existed. The watchdog timer is not even
   * armed — which is why the sink is read where the timer is set rather than where it fires.
   */
  test("an app with no collector is unchanged, and nothing throws", () => {
    globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;

    const container = document.createElement("div");
    document.body.appendChild(container);

    expect(() => {
      bootstrap(<Panel />, container);
      flushSync();
    }).not.toThrow();

    unmount(container);
    container.remove();
  });

  /**
   * The only fault here that is invisible by construction rather than by omission.
   *
   * Commit-level work has no component to blame and is deliberately not rethrown, so a callback
   * that throws leaves nothing behind at all: the page renders, nothing logs, and the work simply
   * did not happen.
   */
  test("a post-commit callback that throws is reported, and the rest still runs", () => {
    captured = collect();
    const ran: string[] = [];

    queueAfterCommit(() => {
      throw new Error("something the app's own code did");
    });
    queueAfterCommit(() => ran.push("after"));
    flushAfterCommit();

    const record = captured.records.find((r) => r.code === "RMD054");
    expect(record).toBeDefined();
    // The isolation this sits inside: one failure must not stop the rest of the pass.
    expect(ran).toEqual(["after"]);
    // Nothing from the thrown error travels — the app decides what may leave the process.
    expect(record!.message).not.toContain("something the app's own code did");
    expect(record!.data).toBeUndefined();
  });

  /**
   * RMD055 is enforcement rather than a diagnostic, and this is where that distinction is worth
   * money: the throw is outside `if (__DEV__)`, so the mistake cannot survive into a build. What
   * production drops is only the explanation — the prose lives in `SPECS`, which does not ship.
   */
  test("a plain-object props bag throws here too, with no record and no prose", () => {
    captured = collect();

    class Echo extends Hook<{ seed: number }> {
      get seed() {
        return this.props.seed;
      }
    }
    class Page extends Component {
      echo = this.use(Echo, { seed: 1 } as never);
      render() {
        return <p>{String(this.echo.seed)}</p>;
      }
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    try {
      expect(() => bootstrap(<Page />, container)).toThrow(/RMD055/);
      expect(captured.records.some((r) => r.code === "RMD055")).toBe(false);
    } finally {
      container.remove();
    }
  });

  test("a deferral that never settles is reported as stalled", async () => {
    captured = collect();
    const container = await serverHtmlInto(<Stuck />);

    vi.useFakeTimers();
    try {
      hydrateRoot(<Stuck />, container);
      vi.advanceTimersByTime(10_000);
      const record = captured.records.find((r) => r.code === "RMD017");
      expect(record).toBeDefined();
      expect(record!.fix).toBeUndefined();
    } finally {
      vi.useRealTimers();
      container.remove();
    }
  });

  test("the stall watchdog is not armed when no collector is installed", async () => {
    globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
    const container = await serverHtmlInto(<Stuck />);

    vi.useFakeTimers();
    try {
      hydrateRoot(<Stuck />, container);
      // Nothing to observe directly, so observe the timer itself: an unarmed watchdog leaves the
      // queue empty, and a armed one would have exactly one entry waiting.
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10_000);
    } finally {
      vi.useRealTimers();
      container.remove();
    }
  });
});
