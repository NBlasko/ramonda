import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../base/Component";
import { diagnose, resetDiagnostics } from "../debug/diagnostics";

/**
 * The records this package hands a collector.
 *
 * The console line and the `ramonda:dev-log` event are unchanged and still the default; this is the
 * third consumer, the one a devtools panel, a test or a log shipper can subscribe to without
 * parsing prose. The shape is asserted over records core really produced, because a written
 * contract is the one thing in this repository with nothing behind it —
 * https://ramonda.dev/reference/diagnostics#capturing-them.
 */

let records: RamondaDiagnostic[] = [];

beforeEach(() => {
  records = [];
  resetDiagnostics();
  vi.spyOn(console, "log").mockImplementation(() => {});
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
});

afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
  vi.restoreAllMocks();
});

describe("the diagnostic record", () => {
  test("a real diagnostic arrives with every field the protocol names", async () => {
    class Bad extends Component {
      @state count = 0;
      render() {
        this.count++;
        return <p>{this.count}</p>;
      }
    }
    const { unmount } = await getDOM(<Bad />);

    const record = records.find((r) => r.code === "RMD001");
    expect(record).toBeDefined();
    expect(record?.scope).toBe("ramonda/core");
    expect(record?.severity).toBe("error");
    // The title and the specifics, in one sentence — the console keeps them on separate lines,
    // which a panel's single-line row cannot show.
    expect(record?.message).toContain("State written during");
    expect(record?.message).toContain("<Bad /> wrote to `count`");
    // The advice is a FIELD, so a panel can render it apart from what happened.
    expect(record?.fix).toContain("@compute");
    expect(record?.time).toBeGreaterThan(1_700_000_000_000);
    unmount();
  });

  test("`warning` becomes `warn`, because the vocabulary belongs to the protocol", () => {
    // This package has always said `warning` and the record says `warn`; the translation is at the
    // emit point, and a collector filtering on severity depends on it being exact.
    diagnose("RMD008", "translate", "a late write");

    const record = records.find((r) => r.code === "RMD008");
    expect(record?.severity).toBe("warn");
    expect(["debug", "info", "warn", "error"]).toContain(record?.severity);
  });

  test("it publishes the key it deduplicates on, and reports once per source", () => {
    diagnose("RMD005", "Panel.items", "first");
    diagnose("RMD005", "Panel.items", "second");
    diagnose("RMD005", "Other.rows", "third");

    expect(records.map((r) => r.dedupKey)).toEqual(["RMD005:Panel.items", "RMD005:Other.rows"]);
  });

  test("`data` carries values and drops anything live", () => {
    /**
     * The case this filter exists for. `propsStability` passes `{ cached, fresh }` — the actual
     * prop values — so a component, a DOM node or an array of them is an ordinary thing to find
     * there. The console gets the whole object, where expanding it is the useful thing; a record
     * cannot, because a collector keeps a bounded history and would hold that tree alive.
     */
    const live = { nodes: [document.createElement("div")], compare: () => true, id: 7, name: "x" };
    diagnose("RMD022", "Panel.bag", "rebuilt", live);

    const record = records.find((r) => r.code === "RMD022");
    expect(record?.data).toEqual({ id: 7, name: "x" });
  });

  test("nothing is published when there is no value worth publishing", () => {
    diagnose("RMD002", "list.key", "duplicate", { node: document.createElement("li") });
    diagnose("RMD003", "Panel.theme");

    expect(records.find((r) => r.code === "RMD002")?.data).toBeUndefined();
    expect(records.find((r) => r.code === "RMD003")?.data).toBeUndefined();
  });

  /**
   * Reporting must not become the fault. Both of these are about `data` holding something an
   * application put in a prop, which is exactly what `propsStability` passes on.
   */
  test("a getter in `data` does not take `diagnose` with it", () => {
    const hostile = {
      get boom(): string {
        throw new Error("a getter is arbitrary code");
      },
      safe: 1,
    };

    // `Object.entries` would have run it, and the throw would have come out of the diagnostic that
    // was explaining what was wrong with the app. An accessor is skipped by descriptor instead — a
    // computed value is not "what the message interpolated" in any case.
    expect(() => diagnose("RMD022", "attack.getter", "detail", hostile)).not.toThrow();
    expect(records.find((r) => r.code === "RMD022")?.data).toEqual({ safe: 1 });

    // Scoped claim on purpose: this is about the RECORD channel. A consumer that serializes `data`
    // itself still invokes the getter, which is inherent to handing an object to a console — so what
    // this guarantees is that `diagnose` returns and the record is clean, not that nobody downstream
    // ever reads it. `@ramonda/devtools` survives its own read; that is asserted in its suite.
  });

  test("a bigint arrives as digits, because a record gets serialized", () => {
    // A `bigint` prop needs no cooperation from anybody, and it is the one primitive
    // `JSON.stringify` throws on — which is what every collector shipping a record does.
    diagnose("RMD022", "attack.bigint", "detail", { size: 9007199254740993n, ok: true });

    const record = records.find((r) => r.code === "RMD022");
    expect(record?.data).toEqual({ size: "9007199254740993", ok: true });
    expect(() => JSON.stringify(record)).not.toThrow();
  });

  test("the console and the dev-log channel are untouched by any of this", () => {
    const logged: unknown[] = [];
    const handler = (event: Event) => logged.push((event as CustomEvent).detail);
    window.addEventListener("ramonda:dev-log", handler);

    try {
      globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
      diagnose("RMD001", "Bad.count", "<Bad /> wrote to `count`");

      // One row, from core's own channel — the format it has always used, with the code, the
      // detail and the fix in one string.
      expect(logged).toHaveLength(1);
      const message = (logged[0] as { message: string }).message;
      expect(message).toContain("[RMD001]");
      expect(message).toContain("<Bad /> wrote to `count`");
      expect(message).toContain("@compute");
    } finally {
      window.removeEventListener("ramonda:dev-log", handler);
    }
  });
});
