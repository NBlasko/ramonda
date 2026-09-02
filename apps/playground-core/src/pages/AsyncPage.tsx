import { Component, state, AsyncLoad } from "@ramonda/core";
import type { AsyncLoadFailure, Lazy } from "@ramonda/core";
import { failureMessage } from "../failureMessage";

/** Drives the "fails twice, then works" demo below. */
let flakyAttempts = 0;

/**
 * A URL that will never exist. Fixed on purpose: the question is whether the
 * browser memoizes a FAILED `import()` of the same specifier, so the specifier
 * must not change between attempts.
 */
const MISSING_CHUNK = "/__ramonda_missing_chunk__.js";

/**
 * The props each lazy panel is handed once it loads.
 *
 * Module constants rather than literals written in the JSX, and the reason is the reason
 * `fresh-object-in-props` exists: a literal is built during the render, so the child is handed a
 * different object every time and props comparison can never match it. Measured — one child goes
 * from one render to two the moment its parent re-renders for any reason at all.
 */
const LAZY_PROPS = { title: "HeavyPanel (lazy)" };
const RETRY_PROPS = { title: "HeavyPanel (after retries)" };
const RACE_PROPS = { title: "HeavyPanel (after the race)" };

/**
 * Lets the "unmounted while still loading" demo finish on demand.
 *
 * This used to be `setTimeout(…, 3000)` inside the lazy, and RMD006 was right to
 * report it: a raw timer started during a component's lifecycle and still armed
 * after it unmounts is a leak, whoever started it. A promise the page resolves
 * has no timer at all — and it makes the race exact instead of a 3-second dash.
 */
let releaseSlowLoad: (() => void) | null = null;

/**
 * The `lazy` thunks, hoisted out of the render — and the reason is the rule the framework reports
 * on itself. A thunk written in the markup is a new function every render, so `AsyncLoad` can never
 * compare its props equal and re-renders whenever this page does (`RMD020`, and `ramonda-check`'s
 * `function-built-in-the-markup`). The module cache tolerates it, because the key is derived from
 * the thunk's SOURCE rather than its identity — but that is a defence against the mistake, not a
 * reason to make it. An `import()` inside a thunk does not run until the thunk is called, so
 * hoisting costs nothing.
 */
const loadHeavyPanel = () => import("../demos/HeavyPanel");

/**
 * Demo 2's own thunk, and it has one so the suppression can live beside the import.
 *
 * The ignore used to sit on the JSX line, because the thunk was written there. Hoisting the thunk
 * moved the import out from under it — and the checker, now able to RESOLVE the module, correctly
 * reported that `namedExport="NotExported"` names nothing in it. That is the demo working, so the
 * reason is written here instead of the thunk being put back.
 */
// ramonda-check-ignore the export is absent on purpose: this demo is what a bad namedExport looks like
const loadHeavyPanelMissingExport = () => import("../demos/HeavyPanel");

const loadFlaky = () => {
  flakyAttempts++;
  return flakyAttempts < 3
    ? Promise.reject(new Error(`simulated network failure #${flakyAttempts}`))
    : import("../demos/HeavyPanel");
};

// Annotated, because hoisting it out of the attribute took away the contextual type the inline
// form had — `new Promise(…)` then infers `Promise<unknown>` and `Lazy` refuses it.
const loadSlowly: Lazy = () =>
  new Promise((resolve) => {
    releaseSlowLoad = () => resolve(import("../demos/HeavyPanel"));
  });

/** The failure fallbacks, for the same reason: written in the markup each is a new function. */
function retryableForever({ error, retry, attempt }: AsyncLoadFailure) {
  return (
    <div className="row">
      <span className="muted small">
        attempt {attempt}: {failureMessage(error)}
      </span>
      <button onclick={retry}>retry (will fail again)</button>
    </div>
  );
}

function retryableTimed({ error, retry, attempt }: AsyncLoadFailure) {
  return (
    <div className="row">
      <span className="muted small">
        attempt {attempt} failed: {failureMessage(error)}
      </span>
      <button onclick={retry}>retry</button>
    </div>
  );
}

/**
 * Counting `resource` entries turned out NOT to work: a module script that fails
 * to load often produces no Performance Timeline entry at all, so the count read
 * 0 whether or not the request was made — it could not tell the two apart.
 *
 * Timing can. A memoized rejection comes back in a microtask; a real request has
 * to reach the server and back. Kept as a list so the FIRST attempt (which is
 * definitely a real request) is there to compare the rest against.
 */
function since(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}

/**
 * `AsyncLoad` — load a module the first time it is rendered.
 *
 * An ordinary class component with the default host, written as a tag like
 * everything else. The loaded module's own props go in `loadedProps` — they
 * belong to a different component and must not share this tag's attributes.
 */
export class AsyncPage extends Component {
  @state showModule = false;
  @state showBroken = false;
  @state showRace = false;
  @state showFlaky = false;
  @state showMemo = false;
  @state durations: number[] = [];

  toggleModule() {
    this.showModule = !this.showModule;
  }
  toggleBroken() {
    this.showBroken = !this.showBroken;
  }
  toggleRace() {
    this.showRace = !this.showRace;
    if (!this.showRace) releaseSlowLoad = null;
  }
  finishSlowLoad() {
    releaseSlowLoad?.();
    releaseSlowLoad = null;
  }
  toggleMemo() {
    this.showMemo = !this.showMemo;
    this.durations = [];
  }
  toggleFlaky() {
    this.showFlaky = !this.showFlaky;
    // Start each demo run from a clean slate.
    if (this.showFlaky) flakyAttempts = 0;
  }

  /**
   * A bound METHOD rather than a thunk in the markup: this one reads `this.durations`, so it cannot
   * be a module constant like the others — and written inline it would still be a new function every
   * render. Ramonda binds methods to the instance, so passing it is all this takes.
   */
  loadMissingChunk() {
    const started = performance.now();
    return import(/* @vite-ignore */ MISSING_CHUNK).catch((error) => {
      this.durations = [...this.durations, since(started)];
      throw error;
    });
  }

  render() {
    return (
      <div className="page">
        <h2>AsyncLoad</h2>
        <p className="muted">
          Loads a module the first time it renders, showing <code>onLoading</code> until it arrives and{" "}
          <code>errorFallback</code> if it never does. Open the Network tab before the first click: the chunk is fetched
          then, not at page load.
        </p>

        <section className="slotcase">
          <div className="row">
            <h3>1 · load on demand</h3>
            <button onclick={this.toggleModule}>{this.showModule ? "unmount it" : "load the module"}</button>
          </div>
          <p className="muted small">
            Load it, click its button a few times, unmount it, and load it again — the second time there is no network
            request and no loading flash, because the module cache is process-wide. Its own <code>@state</code> starts
            over, which is right: the module is cached, the component is not.
          </p>
          {this.showModule ? (
            <AsyncLoad
              lazy={loadHeavyPanel}
              onLoading={<p className="muted">loading the module…</p>}
              errorFallback={<p className="muted">could not load it</p>}
              loadedProps={LAZY_PROPS}
            />
          ) : null}
        </section>

        <section className="slotcase">
          <div className="row">
            <h3>2 · a load that fails</h3>
            <button onclick={this.toggleBroken}>
              {this.showBroken ? "hide" : "ask for an export that is not there"}
            </button>
          </div>
          <p className="muted small">
            The module loads fine; the export named here does not exist in it. AsyncLoad throws inside its own{" "}
            <code>then</code>, catches it, and shows <code>errorFallback</code>. Press retry: it fails again,
            identically, forever — which is exactly why retrying is not automatic. A missing export, or a module that
            throws while evaluating, never recovers on its own.
          </p>
          {this.showBroken ? (
            <AsyncLoad
              lazy={loadHeavyPanelMissingExport}
              namedExport="NotExported"
              cacheKey="missing-export"
              onLoading={<p className="muted">loading…</p>}
              errorFallback={retryableForever}
            />
          ) : null}
        </section>

        <section className="slotcase">
          <div className="row">
            <h3>3 · a retry that works</h3>
            <button onclick={this.toggleFlaky}>{this.showFlaky ? "hide" : "load something flaky"}</button>
          </div>
          <p className="muted small">
            This one fails the first two times on purpose, like a bad connection. Press retry twice and it comes up. The
            fallback is a <em>function</em>, so it receives <code>{"{ error, retry, attempt }"}</code> — the same shape
            as <code>ErrorBoundary</code>'s fallback.
          </p>
          {this.showFlaky ? (
            <AsyncLoad
              lazy={loadFlaky}
              cacheKey="flaky-heavy-panel"
              onLoading={<p className="muted">loading…</p>}
              loadedProps={RETRY_PROPS}
              errorFallback={retryableTimed}
            />
          ) : null}
        </section>

        <section className="slotcase">
          <div className="row">
            <h3>4 · unmounted while still loading</h3>
            <button onclick={this.toggleRace}>{this.showRace ? "unmount NOW" : "start a slow load"}</button>
            <button onclick={this.finishSlowLoad}>let it finish</button>
          </div>
          <p className="muted small">
            The load hangs until you release it, so you own the race. Two orders to try:
            <strong> unmount NOW</strong> then <strong>let it finish</strong> — the import completes, fills the cache,
            and writes nothing to the component that went away (no RMD008 in the console). Or{" "}
            <strong>let it finish</strong> first, for the ordinary path. Either way, loading it again afterwards is
            instant: the cache has it.
          </p>
          {this.showRace ? (
            <AsyncLoad
              lazy={loadSlowly}
              onLoading={<p className="muted">waiting… unmount me, or press "let it finish"</p>}
              errorFallback={<p className="muted">error</p>}
              cacheKey="slow-heavy-panel"
              loadedProps={RACE_PROPS}
            />
          ) : null}
        </section>

        {/* ── 5. the experiment ─────────────────────────────────────────── */}
        <section className="slotcase">
          <div className="row">
            <h3>5 · is a FAILED import memoized?</h3>
            <button onclick={this.toggleMemo}>{this.showMemo ? "hide" : "run the experiment"}</button>
          </div>
          <p className="muted small">
            The open question behind "should retrying be automatic". This imports a URL that does not exist, so the
            failure is a real network round trip — unlike the other cases, which fail before or after the request. Press{" "}
            <strong>retry</strong> a few times and read the timings.
          </p>
          <p className="muted small">
            <strong>If every attempt takes about as long as the first</strong>, a failed import is not memoized and an
            automatic retry could recover from a blip.{" "}
            <strong>If the first takes milliseconds and the rest are ~0</strong>, the browser cached the rejection:
            retrying the same specifier can never succeed, and only a reload would help.
          </p>
          <p className="muted small">
            Measured in Chrome on 2026-07-18: <code>11.9 · 3.7 · 4.4 · 3.4 · 3.3</code>. Every retry is a real round
            trip, so failures are <strong>not</strong> memoized — at least there. Worth re-running in Firefox and Safari
            before relying on it.
          </p>
          <p>
            attempt timings (ms): <strong>{this.durations.length ? this.durations.join(" · ") : "—"}</strong>
          </p>
          {this.showMemo ? (
            <AsyncLoad
              // ramonda-check-ignore the chunk is missing on purpose: this demo is what a failed load looks like
              lazy={this.loadMissingChunk}
              cacheKey="missing-chunk"
              onLoading={<p className="muted">requesting…</p>}
              errorFallback={retryableTimed}
            />
          ) : null}
        </section>

        <section className="slotcase">
          <h3>notes</h3>
          <ul className="muted small">
            <li>
              <code>cacheKey</code> defaults to the source of <code>lazy</code>, which is right for{" "}
              <code>() =&gt; import("./Thing")</code>. Pass it explicitly when two different modules are loaded by
              functions with identical source — they stringify the same and would share one cache entry.
            </li>
            <li>
              No <code>key</code> is injected. Two <code>AsyncLoad</code>s sharing one <code>lazy</code> used to get the
              same vnode key and could take each other's DOM node.
            </li>
            <li>
              <code>errorFallback</code> may be a plain node, or a function receiving{" "}
              <code>{"{ error, retry, attempt }"}</code>. There is no automatic retry: an import mostly fails for
              reasons that do not recover — a chunk removed by a deploy, a module that throws — and repeating those
              costs requests and re-runs side effects.
            </li>
            <li>
              On the server the module is awaited and rendered into the HTML. On hydration the client checks its own
              cache rather than the restored flag, so a client that has not fetched it yet shows <code>onLoading</code>{" "}
              instead of crashing.
            </li>
          </ul>
        </section>
      </div>
    );
  }
}
