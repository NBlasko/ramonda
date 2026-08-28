import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component } from "../../base/Component";
import { state } from "../../base/decorators";
import { AsyncLoad } from "../../base/AsyncLoad";
import { renderPage } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";

/**
 * The ten-second watch armed for a deferred subtree has to be put out when the subtree resumes.
 *
 * It was harmless in the sense that mattered least — the callback re-checks `hydrationPending` and
 * `isDestroyed`, so it can never report falsely. What it did do is hold on. The timer's closure
 * holds the component, and `unref` (the only thing that used to be done about it) is **Node-only**,
 * so in a browser every deferred subtree kept its component alive for ten seconds after it was
 * finished with. A page full of them holds a page full of dead components.
 *
 * Counting live timers is what asserts it, because the diagnostic itself cannot: a resumed subtree
 * produces no report whether the timer is cleared or not, which is exactly why nobody noticed.
 */

class Loaded extends Component<{ label?: string }> {
  @state clicks = 0;
  render() {
    return (
      <div>
        <p>LOADED: {this.props.label ?? "-"}</p>
      </div>
    );
  }
}

interface PageProps {
  ck: string;
  lazy: () => Promise<Record<string, unknown>>;
}

class Page extends Component<PageProps> {
  render() {
    return (
      <div>
        <AsyncLoad
          cacheKey={this.props.ck}
          lazy={this.props.lazy}
          namedExport="Loaded"
          loadedProps={{ label: "from server" }}
          onLoading={<p>loading…</p>}
          errorFallback={<p>failed</p>}
        />
      </div>
    );
  }
}

let container: HTMLElement | undefined;
let resolveImport: ((value: Record<string, unknown>) => void) | undefined;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  container?.remove();
  container = undefined;
  resolveImport = undefined;
  vi.restoreAllMocks();
});

describe("the stalled-hydration watch", () => {
  test("is cleared the moment the subtree resumes", async () => {
    const html = (await renderPage(<Page ck="srv-watch" lazy={() => Promise.resolve({ Loaded })} />)).body;
    expect(html).toContain("LOADED");

    container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    // Held open on purpose: the watch is armed while the import is in flight, which is the only
    // moment there is anything to count.
    const pending = new Promise<Record<string, unknown>>((resolve) => {
      resolveImport = resolve;
    });

    const cleared: unknown[] = [];
    const realClear = globalThis.clearTimeout;
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(((id: unknown) => {
      cleared.push(id);
      return (realClear as (handle: unknown) => void)(id);
    }) as typeof clearTimeout);

    const armed: unknown[] = [];
    const realSet = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      const id = (realSet as (f: () => void, m?: number) => unknown)(fn, ms);
      // Only the watch runs for ten seconds; everything else here is a tick.
      if (ms === 10_000) armed.push(id);
      return id;
    }) as unknown as typeof setTimeout);

    hydrateRoot(<Page ck="cold-watch" lazy={() => pending} />, container);
    await Promise.resolve();

    expect(armed).toHaveLength(1);
    expect(cleared).not.toContain(armed[0]);

    resolveImport?.({ Loaded });
    await new Promise((resolve) => realSet(resolve as () => void, 0));

    // The subtree is live again, and its watch is out — the same timer id, not merely some timer.
    expect(container.textContent).toContain("LOADED");
    expect(cleared).toContain(armed[0]);
  });
});
