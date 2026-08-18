import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { created, Host, state } from "../base/decorators";
import { Component } from "../base/Component";
import { resetDiagnostics } from "../debug/diagnostics";
import { serializeComponentToJSON } from "../hydration/serialize";
import { hydrateRoot } from "../hydration/hydrate";
import { renderToString } from "../hydration/ssr";
import { STATE_ATTR } from "../helpers/constants";
import { list } from "../base/list";
import type { ComponentChild } from "../types/vdom";

/**
 * The four codes nothing had ever fired.
 *
 * Found by crossing three lists during a review of this package: what `SPECS` declares, what the
 * source raises, and what any test names. Fifty-one codes are declared, every one of them is
 * raised, and **`RMD013`, `RMD034`, `RMD035` and `RMD036` were named by no test at all.**
 *
 * That is a worse gap than it sounds. A diagnostic is a promise made in the documentation — the
 * reference has a section per code telling a reader what it means and what to do — and an untested
 * one is a promise with nothing behind it. It can rot in three ways that all look identical from
 * outside: the branch that raises it becomes unreachable, the dedup key collapses so it fires once
 * for everything, or the data it carries stops matching what the page says it carries.
 *
 * All four turned out to WORK. Nothing here is a fix; it is proof, and from now on it is a
 * regression test. What was actually wrong was the note in `CodedMessages.test.tsx` saying the
 * hydration three were covered in `src/__tests__/hydration/` — that directory names `RMD025` and
 * nothing else, so the codes were deferred to a place that never picked them up.
 *
 * ## The one that cost a probe, written down so it costs nobody else one
 *
 * `RMD034` **only arms on a server render.** `DiffAndMerge` snapshots the fields for it under
 * `if (onServer)`, which is right — the fault it describes is state that will not survive to the
 * client, and that cannot happen where there is no server. Mounted on the client the check never
 * arms and the diagnostic is silent, which reads exactly like a broken diagnostic.
 */

let records: RamondaDiagnostic[] = [];

beforeEach(() => {
  records = [];
  resetDiagnostics();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
});

afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
  vi.restoreAllMocks();
});

const codes = () => records.map((record) => record.code);
const of = (code: string) => records.find((record) => record.code === code);

describe("the codes that no test reached", () => {
  /**
   * A render callback that returns nothing for one row. The list keeps going — skipping the row is
   * what stops `.attributes` below it from throwing — so without the diagnostic the row simply
   * vanishes and the page looks like a list with one fewer item than the data has.
   */
  test("RMD013 — a list item that produced nothing", async () => {
    class Rows extends Component {
      @state items = [1, 2, 3];
      render() {
        return <ul>{list(this.items, (n: number) => (n === 2 ? null : <li>{n}</li>))}</ul>;
      }
    }

    const dom = await getDOM(<Rows />);
    await dom.settle();

    expect(codes()).toContain("RMD013");
    // The row that vanished, not the row count: the message has to send a reader to one item.
    expect(of("RMD013")?.message).toContain("item 1");
    // Two rows survive. The diagnostic is the only thing that says the third was ever asked for.
    expect(dom.container.querySelectorAll("li")).toHaveLength(2);
  });

  /**
   * A plain field written during `@created`. It is neither `@state` nor `@persist`, so it is not in
   * the blob, so the client rebuilds the component with the field back at its initial value — and
   * the page differs from the one that was served with nothing else to say so.
   *
   * Server render, because that is the only place the check arms. See the note at the top.
   */
  test("RMD034 — state written during create that will not reach the client", async () => {
    class Leaky extends Component {
      plain = 0;
      @created init() {
        this.plain = 42;
      }
      render() {
        return <p>{this.plain}</p>;
      }
    }

    await renderToString(<Leaky />);
    await Promise.resolve();

    expect(codes()).toContain("RMD034");
    expect(of("RMD034")?.data).toMatchObject({ component: "Leaky", key: "plain" });
  });

  /**
   * The client builds a different number of hooks from the one the server serialized. Hooks are
   * matched BY POSITION, so a mismatch means state is restored onto the wrong hook or dropped —
   * and the restore carries on with the shorter of the two, which is what makes the report the
   * only evidence.
   */
  test("RMD035 — the client's hook tree does not match the server's", async () => {
    @Host("div")
    class Two extends Component {
      @state n = 1;
      render() {
        return <span>{this.n}</span>;
      }
    }

    const server = await getDOM<Two>((<Two />) as ComponentChild);
    await server.settle();
    const host = server.container.firstElementChild as Element & { _componentInstance?: object };

    // A blob claiming two hooks where the client will build none.
    const blob = JSON.parse(serializeComponentToJSON(host._componentInstance!));
    blob.hooks = [{ state: {} }, { state: {} }];
    host.setAttribute(STATE_ATTR, JSON.stringify(blob));
    const html = server.container.innerHTML;
    server.unmount();

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;
    records = [];

    hydrateRoot(<Two />, container);
    await Promise.resolve();

    expect(codes()).toContain("RMD035");
    expect(of("RMD035")?.data).toMatchObject({ client: 0, server: 2 });
  });

  /**
   * A blob that is not JSON. The catch keeps hydration going rather than taking the page down, so
   * the component adopts the server's DOM with none of the server's state — and the mismatch that
   * follows is reported as `RMD007`, whose advice is about clocks and random numbers.
   *
   * That pairing is the point of asserting both: `RMD036` is the report that says what actually
   * happened, and without it a reader is sent looking for non-determinism that is not there.
   */
  test("RMD036 — a state blob that could not be read", async () => {
    @Host("div")
    class Counter extends Component {
      @state count = 0;
      render() {
        return <span id="c">{this.count}</span>;
      }
    }

    const server = await getDOM<Counter>((<Counter />) as ComponentChild);
    server.instance.count = 5;
    await server.settle();
    const host = server.container.firstElementChild as Element & { _componentInstance?: object };
    host.setAttribute(STATE_ATTR, serializeComponentToJSON(host._componentInstance!));

    const html = server.container.innerHTML.replace(/data-ramonda-state="[^"]*"/, 'data-ramonda-state="{not json"');
    server.unmount();

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;
    records = [];

    hydrateRoot(<Counter />, container);
    await Promise.resolve();

    expect(codes()).toContain("RMD036");
    expect(of("RMD036")?.data).toMatchObject({ component: "Counter" });
    // The reason the diagnostic exists: what the reader would otherwise be left with.
    expect(codes()).toContain("RMD007");
  });
});
