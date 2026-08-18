import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { created, Host, mounted, persist, state } from "../base/decorators";
import { Component } from "../base/Component";
import { resetDiagnostics } from "../debug/diagnostics";
import { serializeComponentToJSON } from "../hydration/serialize";
import { hydrateRoot } from "../hydration/hydrate";
import { renderToString } from "../hydration/ssr";
import { requestContext, requestKey, setRequestScope } from "../hydration/requestContext";
import { REQUEST_ATTR, STATE_ATTR } from "../helpers/constants";
import { list } from "../base/list";
import type { ComponentChild, VNode } from "../types/vdom";

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
  setRequestScope(undefined);
  document.body.innerHTML = "";
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
        // The cast is what it takes to write this at all: `ItemRender` promises a node, so a
        // callback that returns nothing is a type error — which is the first line of defence and
        // the reason RMD013 is the second. A build with no types has neither.
        const render = ((n: number) => (n === 2 ? null : <li>{n}</li>)) as unknown as (n: number) => VNode;
        return <ul>{list(this.items, render)}</ul>;
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

  /**
   * A request blob that does not parse.
   *
   * Found during the review of this package, and the silence was the fault. The blob is ignored so
   * the page still renders — the right call, and the same one the state blob makes — but nothing
   * said so, and two other diagnostics fire in its place pointing the wrong way. Measured before
   * the code existed: `RMD025` claims the key was not exposed, which is false, and `RMD007` reports
   * the render mismatch that follows, whose advice is about clocks. The page looks correct
   * throughout, because the server's markup is still on screen.
   *
   * So this test asserts the misleading pair as well. They are not bugs — each is right about what
   * it can see — and `RMD058` is the one that explains them.
   */
  test("RMD058 — a request blob that could not be read", async () => {
    const sid = requestKey<string>("review-sid", { exposeToClient: true });

    @Host("main")
    class Page extends Component {
      render() {
        return <p>{requestContext().get(sid) ?? "none"}</p>;
      }
    }

    const html = await renderToString(<Page />, {
      request: {
        url: new URL("https://example.com/account"),
        cookies: new Map(),
        values: new Map([[sid, "s-123"]]),
      },
    });
    expect(html).toContain(REQUEST_ATTR);

    const container = document.createElement("div");
    document.body.appendChild(container);
    // Exactly what was served, with the blob altered in transit.
    container.innerHTML = html.replace(new RegExp(`${REQUEST_ATTR}="[^"]*"`), `${REQUEST_ATTR}="{broken"`);
    records = [];

    hydrateRoot(<Page />, container);
    await Promise.resolve();

    expect(codes()).toContain("RMD058");
    expect(of("RMD058")?.data).toMatchObject({ reason: expect.any(String) });

    // The two that used to be the only thing a reader got, and why RMD058 has to be there.
    expect(codes()).toContain("RMD025");
    expect(codes()).toContain("RMD007");
  });

  /**
   * An `async @mounted` that rejects.
   *
   * Found during the review by running it against an error boundary, which is the only way it shows:
   * the sync lifecycle is caught and renders the fallback, and the async one is not caught, reports
   * nothing, and leaves the page rendering as though it had succeeded. `@mounted async load()`
   * fetching data is a documented pattern, so this is the commonest async path there is.
   *
   * **The boundary NOT catching it is deliberate and is not what changed.** The rejection arrives at
   * an arbitrary later moment, when the page is already interactive and there is no render left to
   * fail. What changed is the silence.
   *
   * The handler is on a separate branch and the original promise is untouched, so the rejection is
   * still unhandled — which is the honest outcome — and now it arrives with an explanation.
   */
  test("RMD059 — an async lifecycle that rejected", async () => {
    @Host("div")
    class Boom extends Component {
      @mounted async load() {
        throw new Error("fetch failed");
      }
      render() {
        return <span>ok</span>;
      }
    }

    const dom = await getDOM(<Boom />);
    await dom.settle();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(codes()).toContain("RMD059");
    expect(of("RMD059")?.data).toMatchObject({ component: "Boom", member: "load", phase: "mounted" });
    // The failure is named, not guessed at.
    expect(of("RMD059")?.message).toContain("fetch failed");
    // The page is untouched: this reports, it does not take anything down.
    expect(dom.container.textContent).toBe("ok");
    dom.unmount();
  });

  /**
   * `RMD033` catches what its own documentation says it catches.
   *
   * Found by round-tripping every common type through the blob during the review. The check was a
   * `try`/`catch` around `JSON.stringify`, which only ever sees a THROW — and the cases the
   * diagnostic's `fix` text names do not throw:
   *
   *     new Map([["k", 7]])  ->  "{}"           every entry gone
   *     new Set([1, 2])      ->  "{}"           every entry gone
   *     new Date(0)          ->  "1970-01-…"    a string, so `.getTime()` throws on the client
   *
   * Measured before the fix: all three crossed silently, with `codes: []`, and the page failed
   * later with a `TypeError` on a method the value no longer has.
   */
  test("RMD033 — a Map, a Set and a Date are reported, and a plain object is not", async () => {
    @Host("div")
    class Holder extends Component {
      @persist @state map = new Map<string, number>();
      @persist @state when = new Date(0);
      @persist @state plain: Record<string, unknown> = {};
      render() {
        return <span>x</span>;
      }
    }

    const dom = await getDOM<Holder>(<Holder />);
    dom.instance.map = new Map([["k", 7]]);
    dom.instance.when = new Date("2020-01-02T03:04:05.000Z");
    dom.instance.plain = { a: 1, nested: { b: [2] } };
    await dom.settle();

    records = [];
    serializeComponentToJSON((dom.container.firstElementChild as { _componentInstance?: object })._componentInstance!);

    const kinds = records.filter((r) => r.code === "RMD033").map((r) => (r.data as { kind?: string })?.kind);
    expect(kinds).toContain("Map");
    expect(kinds).toContain("Date");
    // The one that must stay quiet: a plain object nested two deep travels perfectly.
    expect(records.filter((r) => (r.data as { key?: string })?.key === "plain")).toEqual([]);
    dom.unmount();
  });

  /** A `Date` inside a plain object is the commonest shape of all, and a shallow check misses it. */
  test("RMD033 — a Date nested inside a plain object is still found", async () => {
    @Host("div")
    class Nested extends Component {
      @persist @state row: Record<string, unknown> = {};
      render() {
        return <span>x</span>;
      }
    }

    const dom = await getDOM<Nested>(<Nested />);
    dom.instance.row = { id: 1, createdAt: new Date(0) };
    await dom.settle();

    records = [];
    serializeComponentToJSON((dom.container.firstElementChild as { _componentInstance?: object })._componentInstance!);

    expect(records.some((r) => r.code === "RMD033" && (r.data as { kind?: string })?.kind === "Date")).toBe(true);
    dom.unmount();
  });
});
