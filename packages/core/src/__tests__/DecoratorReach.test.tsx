import { describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import type { RamondaNode } from "../types/vdom";
import { renderToString } from "../hydration/ssr";
import {
  Host,
  compute,
  create,
  destroy,
  interval,
  mount,
  onWindow,
  state,
  timeout,
  updated,
  watchProp,
} from "../base/decorators";

/**
 * The two questions the reference table answers, measured rather than remembered:
 * does a decorator reach a HOOK, and does it fire on the SERVER.
 *
 * Kept as a test because a table is documentation that cannot fail a build, and these answers
 * are the kind that drift — a lifecycle gains a phase, an effect changes where it attaches, and
 * the page still says what was true a year ago. See apps/docs/content/reference/decorators.md.
 */

const fired: string[] = [];

describe("a hook reaches everything except the three that need an element or a parent", () => {
  test("lifecycles, reacting and derived values all run on a hook", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    fired.length = 0;

    class Full extends Hook<{ n?: number }> {
      @state own = 0;
      @create c() {
        fired.push("create");
      }
      @mount m() {
        fired.push("mount");
      }
      @destroy d() {
        fired.push("destroy");
      }
      @updated u() {
        fired.push("updated");
      }
      @watchProp((props: { n?: number }) => props.n) onN() {
        fired.push("watchProp");
      }
      @compute get doubled() {
        return (this.props.n ?? 0) * 2;
      }
      @mount read() {
        fired.push(`compute:${this.doubled}`);
      }
    }

    @Host("div")
    class Owner extends Component {
      @state n = 1;
      h = this.use(Full, () => ({ n: this.n }));
      render() {
        return <span>{this.n}</span>;
      }
    }

    const app = await getDOM<Owner>(<Owner />);
    await app.settle();
    expect(fired).toContain("create");
    expect(fired).toContain("mount");
    expect(fired).toContain("compute:2");

    // A prop change on the hook drives both the watcher and the post-commit hook.
    app.instance.n = 5;
    await app.settle();
    expect(fired).toContain("watchProp");
    expect(fired).toContain("updated");

    app.unmount();
    await app.settle();
    expect(fired).toContain("destroy");
    vi.restoreAllMocks();
  });

  test("timers on a hook start on mount and are cleared on unmount", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    fired.length = 0;

    class Timed extends Hook {
      @interval(5) tick() {
        fired.push("interval");
      }
      @timeout(5) once() {
        fired.push("timeout");
      }
    }

    @Host("div")
    class Owner extends Component {
      h = this.use(Timed);
      render() {
        return <span>x</span>;
      }
    }

    const app = await getDOM<Owner>(<Owner />);
    await app.settle();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fired).toContain("interval");
    expect(fired).toContain("timeout");

    app.unmount();
    const after = fired.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Nothing more: the effect's cleanup cleared both.
    expect(fired.length).toBe(after);
    vi.restoreAllMocks();
  });
});

describe("what a server render actually runs", () => {
  test("@create, @mount and @compute fire; the rest have no occasion to", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    fired.length = 0;

    class ServerHook extends Hook {
      @create c() {
        fired.push("hook:create");
      }
      @mount m() {
        fired.push("hook:mount");
      }
      @destroy d() {
        fired.push("hook:destroy");
      }
      @onWindow("resize") w() {
        fired.push("hook:onWindow");
      }
      @interval(5) i() {
        fired.push("hook:interval");
      }
    }

    @Host("div")
    class Page extends Component {
      @state n = 2;
      h = this.use(ServerHook);
      @create c() {
        fired.push("create");
      }
      @mount m() {
        fired.push("mount");
      }
      @destroy d() {
        fired.push("destroy");
      }
      @updated u() {
        fired.push("updated");
      }
      @interval(5) tick() {
        fired.push("interval");
      }
      @timeout(5) once() {
        fired.push("timeout");
      }
      @onWindow("resize") w() {
        fired.push("onWindow");
      }
      @compute get doubled() {
        fired.push("compute");
        return this.n * 2;
      }
      render() {
        return <span>{this.doubled}</span>;
      }
    }

    const html = await renderToString(<Page />);
    expect(html).toContain("4");

    // Long enough that a timer or a listener would have shown up if either had been installed.
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect([...new Set(fired)].sort()).toEqual(["compute", "create", "hook:create", "hook:mount", "mount"]);

    /**
     * Read that list carefully, because the reasons differ and the table says so:
     *
     * - EFFECTS — @onWindow/@onDocument/@onElement, @interval/@timeout, subscriptions — are
     *   client-only by construction. They never attach on the server, whatever their env.
     * - @destroy and @updated are `shared` and would run on the server; they simply have no
     *   occasion to. A server render commits once and never unmounts.
     */
    vi.restoreAllMocks();
  });
});

/**
 * `@watchProp` stacked on ONE method, which is the supported way to have one handler follow several
 * props — the reference table says "several watch different props" and stops there, so this measures
 * the part a reader actually needs next: how often the method runs.
 *
 * Each application pushes its OWN entry, with its own `lastValue`, both bound to the same method. So it
 * is one call per CHANGED prop, not one call per update: move one and it runs once, move two in the same
 * update and it runs twice, each time with that selector's own previous and next value. That is useful
 * rather than a defect — a handler watching `a` and `b` is told which one moved — but it is not what
 * "watch several props" sounds like, so it is written down.
 *
 * The order is reverse of declaration, because a member decorator's initializers run bottom-up.
 */
describe("several @watchProp on one method", () => {
  test("one call per changed prop, each with its own before and after", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const calls: string[] = [];

    class Child extends Component<{ a: number; b: number }> {
      @watchProp((props: { a: number; b: number }) => props.a)
      @watchProp((props: { a: number; b: number }) => props.b)
      onEither(next: number, previous: number) {
        calls.push(`${previous}->${next}`);
      }
      render(): RamondaNode {
        return <p>{this.props.a + this.props.b}</p>;
      }
    }

    class App extends Component {
      @state a = 1;
      @state b = 10;
      render(): RamondaNode {
        return <Child a={this.a} b={this.b} />;
      }
    }

    const app = await getDOM<App>(<App />);
    try {
      calls.length = 0;

      // One prop moves: one call, from the selector that saw the change.
      app.instance.a = 2;
      await app.settle();
      expect(calls).toEqual(["1->2"]);

      // Both move in ONE update: two calls, not one — and the lower declaration goes first.
      calls.length = 0;
      app.instance.a = 3;
      app.instance.b = 30;
      await app.settle();
      expect(calls).toEqual(["10->30", "2->3"]);
    } finally {
      app.unmount();
      vi.restoreAllMocks();
    }
  });
});
