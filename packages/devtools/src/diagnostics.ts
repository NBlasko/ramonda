/**
 * The collector side of the diagnostics protocol: one sink on `globalThis`, which
 * every reporting package finds without depending on anything.
 *
 * See https://ramonda.pages.dev/reference/diagnostics#capturing-them for the
 * record and the rules. This file is the other half — what receives them.
 */

/**
 * One diagnostic, as a reporting package hands it over.
 *
 * Declared rather than imported, and identically to the copy in every reporting
 * package. That duplication IS the protocol: a package that emits one of these
 * must be free to have no dependencies, so what is shared is the shape and the
 * name below, never a module. Each package's own suite asserts the shape it
 * produces, which is what keeps the copies honest.
 */
declare global {
  interface RamondaDiagnostic {
    code: string;
    scope: string;
    severity: "debug" | "info" | "warn" | "error";
    message: string;
    fix?: string;
    data?: Record<string, unknown>;
    time: number;
    dedupKey?: string;
  }

  var __RAMONDA_DIAGNOSTICS__: ((record: RamondaDiagnostic) => void) | undefined;
}

type Sink = (record: RamondaDiagnostic) => void;

/**
 * The installed sink, which multiplexes to every subscriber.
 *
 * A function rather than an array, because the emitter's side must stay one
 * property read and one call — `globalThis.__RAMONDA_DIAGNOSTICS__?.(record)` —
 * with no iteration and no `Array.isArray` on a path that runs for every report.
 * The fan-out lives here, where nobody is counting bytes.
 *
 * `sinks` is the marker that makes the hub recognisable as OURS, and it is what
 * the reuse below hinges on.
 */
interface Hub extends Sink {
  sinks: Set<Sink>;
  /**
   * The panel bridge's uninstall, kept on the hub rather than in this module's
   * state — because module state is exactly what a hot reload throws away. A
   * reload that could not find its own previous bridge would add a second one and
   * every record would arrive at the panel twice.
   */
  unbridge?: () => void;
}

function isHub(sink: Sink | undefined): sink is Hub {
  return typeof sink === "function" && "sinks" in sink;
}

/**
 * The hub, created once and then reused.
 *
 * Reuse rather than chaining is the whole point, and the case it exists for is a
 * hot reload: this module re-executes, `installDiagnostics` runs again, and a
 * naive "wrap whatever is there" would chain the new hub onto the PREVIOUS
 * generation of itself — duplicate records, and a chain that grows by one on
 * every save. Recognising our own hub and adding to its `Set` cannot do that.
 *
 * A FOREIGN sink installed before us is chained, not replaced: something else was
 * already listening, and silently dropping it would be the same class of fault
 * this whole protocol exists to make visible.
 */
function hub(): Hub {
  const existing = globalThis.__RAMONDA_DIAGNOSTICS__;
  if (isHub(existing)) {
    ours = existing;
    return existing;
  }

  const sinks = new Set<Sink>();
  const created = ((record: RamondaDiagnostic) => {
    for (const sink of sinks) sink(record);
    existing?.(record);
  }) as Hub;
  created.sinks = sinks;

  globalThis.__RAMONDA_DIAGNOSTICS__ = created;
  ours = created;
  return created;
}

/**
 * The hub we installed, held here as well as on the global.
 *
 * `diagnosticsReachUs` needs a way to observe the hub that does NOT go through the
 * global, because the global is the thing under suspicion. Reading it back would
 * make the check repair what it was asked to measure: it would find a stranger's
 * function, wrap it in a fresh hub, subscribe to that, and report success.
 */
let ours: Hub | undefined;

/**
 * Subscribes to every diagnostic any package reports. Returns the uninstall.
 *
 * The only sanctioned way in, because assigning the sink by hand is how a second
 * consumer silently replaces the first — and a lost subscription reports nothing,
 * which is indistinguishable from a quiet app. Call the returned function from
 * `import.meta.hot?.dispose` in a module that hot-reloads.
 */
export function installDiagnostics(sink: Sink): () => void {
  const installed = hub();
  installed.sinks.add(sink);
  return () => {
    installed.sinks.delete(sink);
  };
}

/**
 * Whether the sink still reaches us, checked by sending one record through it.
 *
 * The hub can only be replaced by code that assigns the global directly, and that
 * code is by definition not calling anything here — so there is no hook to notice
 * it from. A round trip at startup is the one cheap way to find out, and it costs
 * nothing per report: a `debug` record goes out, and if it does not come back,
 * something downstream is not us.
 *
 * `debug` rather than a higher severity so a collector that forwards everything
 * does not report the check as a fault.
 */
export function diagnosticsReachUs(): boolean {
  // Nothing subscribed yet, so there is nothing that could have been taken.
  if (ours === undefined) return true;

  let seen = false;
  const probe = () => {
    seen = true;
  };
  // Added to the hub we already have, NOT through `installDiagnostics`: that would
  // call `hub()`, which repairs a replaced global by wrapping it — and a check that
  // fixes the thing it measures always passes.
  ours.sinks.add(probe);

  try {
    // `debug`, from this package's own scope, and not a registry code: a collector
    // reading tolerantly ignores it, and giving it an `RM…###` would demand a
    // section in the diagnostics reference for a probe.
    globalThis.__RAMONDA_DIAGNOSTICS__?.({
      code: "selftest",
      scope: "ramonda/devtools",
      severity: "debug",
      message: "diagnostics sink round-trip check",
      time: Date.now(),
    });
  } finally {
    ours.sinks.delete(probe);
  }

  return seen;
}

/* ── the bridge to the panel ──────────────────────────────────────────────────────────────── */

/** What the panel's Logs tab reads. Its `type` is a display concern, hence the mapping. */
interface DevLogPayload {
  data: unknown;
  id: string;
  message: string;
  timestamp: string;
  type: string;
}

const TYPE_OF: Record<RamondaDiagnostic["severity"], string> = {
  error: "error",
  warn: "warning",
  info: "info",
  debug: "info",
};

/**
 * Bounded, and replayed when a panel says it is ready.
 *
 * Startup is where the interesting diagnostics are, and a panel mounts after the
 * app has already run — so without this, everything reported before the element
 * connected would be dispatched to nobody. Core's logger keeps its own vault for
 * the same reason and at the same size.
 */
const MAX_VAULT = 500;
const vault: DevLogPayload[] = [];

/**
 * A per-session counter, not a random id.
 *
 * The record deliberately carries no id: minting one is where a reporting package
 * would reach for `crypto.randomUUID`, which core's purity guard patches — a
 * diagnostic raised during a render then trips RMD021 and the framework reports
 * itself. Measured once already, in three of core's own tests. A counter cannot,
 * and it is stable enough for a DOM id and for a test to read.
 */
let nth = 0;

/**
 * Turns a record into the payload the panel renders.
 *
 * The `fix` goes into `data` rather than the message on purpose: the message is
 * rendered as one line of text, while `data` is a `pre-wrap` block, so a
 * paragraph of advice is legible in one and not the other.
 *
 * Nothing here requires a field beyond the five the protocol guarantees — no
 * `fix`, no `data`, no known `scope`. A record from a package this one has never
 * heard of renders like any other, which is what makes the channel worth
 * offering to anybody.
 */
export function toDevLog(record: RamondaDiagnostic): DevLogPayload {
  nth += 1;
  const detail = { scope: record.scope, ...(record.fix === undefined ? {} : { fix: record.fix }), ...record.data };

  return {
    id: `${record.code}-${nth}`,
    type: TYPE_OF[record.severity] ?? "info",
    message: `[${record.code}] ${record.message}`,
    // The record keeps epoch millis, which sort; the panel wants something a
    // person reads. Formatting at the edge is the only place it can be both.
    timestamp: new Date(record.time).toLocaleTimeString(),
    data: detail,
  };
}

/**
 * Sends every diagnostic to the panel, and keeps a bounded history for one that
 * has not opened yet.
 *
 * Installed once, at import time, because an app's whole relationship with this
 * package is `import "@ramonda/devtools"` — the same reason importing it defines
 * the element.
 */
export function bridgeDiagnosticsToPanel(): () => void {
  const installed = hub();
  // Ours from a previous generation of this module, if there is one.
  installed.unbridge?.();

  const uninstall = installDiagnostics((record) => {
    // `debug` is for a collector that asked for it, not for the Logs tab, which
    // has no level control and is read by someone looking for what went wrong.
    // It is also what keeps `diagnosticsReachUs` from writing a row every time a
    // panel mounts — measured: 65 of them across one run of the panel suite.
    if (record.severity === "debug") return;

    /**
     * Core reaches the tab on its own, so this bridge must not carry it there twice.
     *
     * `@ramonda/core` dispatches `ramonda:dev-log` from its own logger and keeps its own replay
     * vault, and in DEV it is what dynamically imports THIS package — so the bridge is always
     * present wherever core is reporting. Without this line every core diagnostic renders as two
     * rows, which core's own suite caught the moment it started emitting records: a test reading the
     * dev-log channel found this bridge's payload instead of core's message.
     *
     * Skipped for the tab only. A record from core still reaches every other subscriber, which is
     * the entire point of `installDiagnostics` — and when core's channel is eventually retired, this
     * condition goes with it.
     */
    if (record.scope === "ramonda/core") return;

    const payload = toDevLog(record);
    vault.push(payload);
    if (vault.length > MAX_VAULT) vault.shift();
    window.dispatchEvent(new CustomEvent("ramonda:dev-log", { detail: payload }));
  });

  const replay = () => {
    if (vault.length > 0) window.dispatchEvent(new CustomEvent("ramonda:logs-sync", { detail: [...vault] }));
  };
  window.addEventListener("ramonda:devtools-ready", replay);

  const teardown = () => {
    uninstall();
    window.removeEventListener("ramonda:devtools-ready", replay);
    if (installed.unbridge === teardown) installed.unbridge = undefined;
  };
  installed.unbridge = teardown;
  return teardown;
}
