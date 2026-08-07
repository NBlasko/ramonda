import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridgeDiagnosticsToPanel, diagnosticsReachUs, installDiagnostics, toDevLog } from "../diagnostics";

/**
 * The collector side of the diagnostics protocol.
 *
 * Every case here is a failure mode the design was chosen to avoid, so each one
 * says which: a second consumer silently replacing the first, a hot reload
 * chaining onto its own previous generation, a foreign sink dropped on the floor,
 * and — the one that keeps the channel worth offering to anybody — a record from a
 * package this one has never heard of.
 */

const record = (over: Partial<RamondaDiagnostic> = {}): RamondaDiagnostic => ({
  code: "RML004",
  scope: "ramonda/lens",
  severity: "warn",
  message: ".posts has 2 element(s), so index 9 is out of range.",
  fix: "A negative index counts from the end.",
  data: { path: ".posts", index: 9, length: 2 },
  time: 1_760_000_000_000,
  ...over,
});

const emit = (over: Partial<RamondaDiagnostic> = {}) => globalThis.__RAMONDA_DIAGNOSTICS__?.(record(over));

beforeEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
});

afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
});

describe("the sink", () => {
  it("is one function, and a reporter needs nothing but the global", () => {
    const seen: RamondaDiagnostic[] = [];
    installDiagnostics((r) => seen.push(r));

    // Exactly what a reporting package does, with no import and no knowledge of us.
    emit();

    expect(seen).toHaveLength(1);
    expect(seen[0].code).toBe("RML004");
  });

  it("carries several subscribers, so a second one does not replace the first", () => {
    const first: string[] = [];
    const second: string[] = [];
    installDiagnostics((r) => first.push(r.code));
    installDiagnostics((r) => second.push(r.code));

    emit();

    // The failure this prevents is silent: the first consumer simply stops
    // receiving, which reads exactly like an app with nothing to report.
    expect(first).toEqual(["RML004"]);
    expect(second).toEqual(["RML004"]);
  });

  it("stops delivering after uninstall, and leaves the others alone", () => {
    const kept: string[] = [];
    const dropped: string[] = [];
    installDiagnostics((r) => kept.push(r.code));
    const uninstall = installDiagnostics((r) => dropped.push(r.code));

    uninstall();
    emit();

    expect(kept).toEqual(["RML004"]);
    expect(dropped).toEqual([]);
  });

  it("reuses its own hub rather than chaining onto a previous generation of itself", () => {
    // What a hot reload does: this module runs again and subscribes again. Wrapping
    // whatever is already installed would grow a chain by one on every save, and
    // every record would arrive as many times as the module had been reloaded.
    const seen: string[] = [];
    for (let reload = 0; reload < 5; reload++) installDiagnostics((r) => seen.push(`sink${reload}:${r.code}`));

    const hub = globalThis.__RAMONDA_DIAGNOSTICS__;
    emit();

    expect(seen).toHaveLength(5);
    // One hub holding five subscribers, not five hubs wrapping each other.
    expect((hub as unknown as { sinks: Set<unknown> }).sinks.size).toBe(5);
  });

  it("keeps a foreign sink that was installed first", () => {
    const foreign: string[] = [];
    // Someone else's collector, written against the shape and nothing else.
    globalThis.__RAMONDA_DIAGNOSTICS__ = (r) => foreign.push(r.code);

    const ours: string[] = [];
    installDiagnostics((r) => ours.push(r.code));
    emit();

    expect(ours).toEqual(["RML004"]);
    expect(foreign).toEqual(["RML004"]);
  });
});

describe("noticing that the sink was taken", () => {
  it("confirms a round trip while the hub is ours", () => {
    installDiagnostics(() => {});
    expect(diagnosticsReachUs()).toBe(true);
  });

  it("reports the truth when something assigned the global instead of subscribing", () => {
    installDiagnostics(() => {});
    // The reference page shows this line, so somebody will write it.
    globalThis.__RAMONDA_DIAGNOSTICS__ = () => {};

    expect(diagnosticsReachUs()).toBe(false);
  });

  it("is satisfied by a wrapper that still passes records on", () => {
    installDiagnostics(() => {});
    const previous = globalThis.__RAMONDA_DIAGNOSTICS__;
    globalThis.__RAMONDA_DIAGNOSTICS__ = (r) => previous?.(r);

    // A chained collector is a supported thing to be, so this must NOT complain —
    // which is why the check is a round trip and not a comparison of identities.
    expect(diagnosticsReachUs()).toBe(true);
  });

  it("leaves nothing subscribed behind it, and its probe is one a collector can ignore", () => {
    const seen: RamondaDiagnostic[] = [];
    installDiagnostics((r) => seen.push(r));

    diagnosticsReachUs();
    emit();
    diagnosticsReachUs();

    // The probe goes through the real path, so every subscriber does see it — that
    // is what makes the check mean anything. What it must not do is look like a
    // fault: `debug`, from this package's scope, which the panel bridge drops and a
    // collector reading tolerantly can filter.
    const probes = seen.filter((r) => r.code === "selftest");
    expect(probes).toHaveLength(2);
    for (const probe of probes) {
      expect(probe.severity).toBe("debug");
      expect(probe.scope).toBe("ramonda/devtools");
    }
    // And no sink of the probe's own outlived it: two checks, two probe records,
    // not one check compounding into the next.
    expect(seen.filter((r) => r.code === "RML004")).toHaveLength(1);
  });
});

describe("the payload the panel renders", () => {
  it("puts the code in the message and the fix where a paragraph is legible", () => {
    const log = toDevLog(record());

    expect(log.message).toBe("[RML004] .posts has 2 element(s), so index 9 is out of range.");
    // `data` is the panel's `pre-wrap` block; the message is one line of text.
    expect(log.data).toMatchObject({ scope: "ramonda/lens", fix: "A negative index counts from the end." });
    expect(log.data).toMatchObject({ path: ".posts", index: 9, length: 2 });
  });

  it("maps severity onto what the panel colours by", () => {
    expect(toDevLog(record({ severity: "error" })).type).toBe("error");
    expect(toDevLog(record({ severity: "warn" })).type).toBe("warning");
    expect(toDevLog(record({ severity: "info" })).type).toBe("info");
  });

  it("formats the time for a reader and keeps the record's own sortable", () => {
    const log = toDevLog(record({ time: 1_760_000_000_000 }));

    expect(typeof log.timestamp).toBe("string");
    expect(log.timestamp).not.toBe("1760000000000");
    // A locale string cannot be compared; the record keeps millis so a collector can.
    expect(record().time).toBeGreaterThan(1_700_000_000_000);
  });

  it("gives every row a distinct id without asking anything for randomness", () => {
    // A reporter minting an id would reach for `crypto.randomUUID`, which core's
    // purity guard patches — so a diagnostic raised during a render would make the
    // framework report itself. A counter cannot.
    const ids = [toDevLog(record()).id, toDevLog(record()).id, toDevLog(record()).id];

    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id.startsWith("RML004-")).toBe(true);
  });

  /**
   * The test that keeps the channel open to strangers.
   *
   * A record is guaranteed to carry `code`, `scope`, `severity`, `message` and
   * `time`, and nothing else. The moment this panel needs more than that, a
   * library that is not Ramonda's cannot use the channel without pretending to be
   * — which is the whole failure this protocol was shaped to avoid.
   */
  it("renders a record from a package it has never heard of", () => {
    const foreign: RamondaDiagnostic = {
      code: "ACME042",
      scope: "acme/store",
      severity: "error",
      message: "a slice was replaced while a subscriber was reading it",
      time: 1_760_000_000_000,
    };

    const log = toDevLog(foreign);

    expect(log.message).toBe("[ACME042] a slice was replaced while a subscriber was reading it");
    expect(log.type).toBe("error");
    expect(log.id.startsWith("ACME042-")).toBe(true);
    // No `fix`, no `data` — and the payload is still complete.
    expect(log.data).toEqual({ scope: "acme/store" });
  });

  it("survives a severity it does not know", () => {
    const log = toDevLog({ ...record(), severity: "critical" as RamondaDiagnostic["severity"] });
    expect(log.type).toBe("info");
  });
});

describe("the bridge to the panel", () => {
  let dispatched: Array<{ type: string; detail: unknown }>;
  let teardown: () => void;
  let listening: AbortController;

  beforeEach(() => {
    dispatched = [];
    // An `AbortController`, because a listener added per test and never removed
    // accumulates — which showed up as one event counted four times by the fourth
    // case, a fault in the test rather than in what it was testing.
    listening = new AbortController();
    for (const name of ["ramonda:dev-log", "ramonda:logs-sync"]) {
      window.addEventListener(
        name,
        (event) => {
          dispatched.push({ type: name, detail: (event as CustomEvent).detail });
        },
        { signal: listening.signal },
      );
    }
    teardown = bridgeDiagnosticsToPanel();
  });

  afterEach(() => {
    teardown();
    listening.abort();
  });

  it("dispatches each record on the channel the Logs tab already listens to", () => {
    emit({ code: "RML005", severity: "warn", message: "matched no element" });

    const logs = dispatched.filter((e) => e.type === "ramonda:dev-log");
    expect(logs).toHaveLength(1);
    expect((logs[0].detail as { message: string }).message).toContain("[RML005]");
  });

  it("replays what was reported before a panel existed", () => {
    // Startup is where the interesting diagnostics are, and a panel mounts after
    // the app has already run.
    emit({ code: "RML001" });
    emit({ code: "RML002", severity: "error" });
    expect(dispatched.filter((e) => e.type === "ramonda:logs-sync")).toHaveLength(0);

    window.dispatchEvent(new CustomEvent("ramonda:devtools-ready"));

    const sync = dispatched.filter((e) => e.type === "ramonda:logs-sync");
    expect(sync).toHaveLength(1);
    const history = sync[0].detail as Array<{ message: string }>;
    // The tail, not the whole thing: the vault is a session history and outlives one
    // test, which is the behaviour an app wants and a per-test reset would hide.
    expect(history.slice(-2).map((entry) => entry.message.slice(0, 9))).toEqual(["[RML001] ", "[RML002] "]);
  });

  it("does not forward `debug`, which the Logs tab has no control for", () => {
    emit({ severity: "debug" });
    expect(dispatched.filter((e) => e.type === "ramonda:dev-log")).toHaveLength(0);
  });

  it("does not carry a core diagnostic to the tab, which core reaches on its own", () => {
    // `@ramonda/core` dispatches `ramonda:dev-log` itself and, in DEV, is what dynamically imports
    // this package — so without the skip every core diagnostic renders TWICE. Core's own suite
    // found it the moment core started emitting records: a test reading the dev-log channel got
    // this bridge's payload instead of core's message, and seventeen cases failed.
    const seen: RamondaDiagnostic[] = [];
    installDiagnostics((r) => seen.push(r));

    emit({ code: "RMD001", scope: "ramonda/core", severity: "error" });

    expect(dispatched.filter((e) => e.type === "ramonda:dev-log")).toHaveLength(0);
    // Skipped for the TAB only: a subscriber still receives it, which is what `installDiagnostics`
    // is for.
    expect(seen.map((r) => r.code)).toEqual(["RMD001"]);
  });

  it("replaces its own previous bridge instead of adding a second", () => {
    // The hot-reload case, and the symptom it prevents is every record arriving twice.
    const second = bridgeDiagnosticsToPanel();
    emit();

    expect(dispatched.filter((e) => e.type === "ramonda:dev-log")).toHaveLength(1);
    second();
  });

  it("replays once after a reload, not once per generation", () => {
    // The dev-log path is not the only one a second bridge could double: each one also
    // listens for a panel announcing itself, and a listener left behind would hand the
    // panel its whole history twice.
    const second = bridgeDiagnosticsToPanel();
    emit();
    window.dispatchEvent(new CustomEvent("ramonda:devtools-ready"));

    expect(dispatched.filter((e) => e.type === "ramonda:logs-sync")).toHaveLength(1);
    second();
  });

  it("bounds the history it keeps", () => {
    // A session runs for hours and a miss here is data-dependent, so the vault is the one
    // place in this design that could grow without limit. 500 is the cap core's logger uses.
    for (let i = 0; i < 620; i++) emit({ code: "RML005", message: `miss ${i}` });
    window.dispatchEvent(new CustomEvent("ramonda:devtools-ready"));

    const history = dispatched.filter((e) => e.type === "ramonda:logs-sync").at(-1)?.detail as Array<{
      message: string;
    }>;

    expect(history).toHaveLength(500);
    // The oldest go, not the newest: a bound that dropped incoming records would hide the
    // fault happening now in favour of one from an hour ago.
    //
    // The vault is oldest-first — it is a queue, and the panel is what reverses it by
    // prepending each row. Two orderings for the same data, so the direction is asserted
    // rather than assumed.
    expect(history.at(0)?.message).toContain("miss 120");
    expect(history.at(-1)?.message).toContain("miss 619");
  });
});

describe("a panel in an ordinary app", () => {
  it("mounts without complaining about the sink", async () => {
    // The reachability check runs on every mount, and a false alarm there would appear in
    // every application that opens the panel — the most visible way to get this wrong.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await import("../index");

    const panel = document.createElement("ramonda-devtools");
    document.body.appendChild(panel);

    expect(warn.mock.calls.flat().join(" ")).not.toContain("no longer reaching this panel");

    panel.remove();
    warn.mockRestore();
  });
});

describe("the panel", () => {
  it("says so when something takes the sink out from under it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await import("../index");
    globalThis.__RAMONDA_DIAGNOSTICS__ = () => {};

    const panel = document.createElement("ramonda-devtools");
    document.body.appendChild(panel);

    expect(warn.mock.calls.flat().join(" ")).toContain("no longer reaching this panel");

    panel.remove();
    warn.mockRestore();
  });
});
