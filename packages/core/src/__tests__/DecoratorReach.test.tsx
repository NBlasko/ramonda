import { describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
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
