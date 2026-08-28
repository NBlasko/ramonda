import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component, ErrorBoundary, AsyncLoad, list } from "../index";
import { state } from "../base/decorators";
import { getDOM } from "../test/setup";
import type { RamondaNode } from "../types/vdom";

/**
 * Queue item 5: what a throw does to the shapes items 3 and 4 built.
 *
 * The rule underneath is the one context already follows — **a slot belongs where it LANDS** — and
 * the interesting half is that error handling obeys it too. A `<Bomb />` written inside one
 * component and rendered inside another is caught by the nearest boundary above where it WENT, and
 * nothing about where the JSX was typed changes that. The three cases below say it from all sides,
 * including the one where the writer's boundary catches — which is the same rule, because a writer
 * that renders the landing component is above it.
 *
 * The other half is scope. A boundary outside a slot replaces everything under it, the slot and its
 * host element included; a boundary inside the slot, around one row, replaces that row. Both are
 * asserted by what SURVIVES, not only by what is caught — a fallback appearing proves a throw was
 * caught, and says nothing about how much it took with it.
 */
class Panel extends Component<{ slot?: RamondaNode }> {
  render() {
    return <section className="panel">{this.props.slot}</section>;
  }
}

/** Throws on demand, so a row can start healthy and fail on a later render. */
class Bomb extends Component<{ boom?: boolean }> {
  render() {
    if (this.props.boom) throw new Error("boom");
    return <b className="ok">ok</b>;
  }
}

const shown = (root: Element) => ({
  ok: root.querySelectorAll(".ok").length,
  panels: root.querySelectorAll(".panel").length,
  caught: [...root.querySelectorAll(".caught")].map((node) => node.textContent),
});

describe("how much a boundary takes with it", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  /**
   * Outside the slot, so the guarded subtree is the slot AND its host. The panel going with it is
   * the point: the boundary replaces what it wraps, not what threw.
   */
  test("a boundary outside the slot replaces the slot and its host", async () => {
    class Outside extends Component {
      @state rows = [{ id: "a" }, { id: "b" }];
      @state badId = "";
      render() {
        return (
          <ErrorBoundary fallback={({ message }) => <i className="caught">{message}</i>}>
            <Panel slot={list(this.rows, (row) => <Bomb key={row.id} boom={row.id === this.badId} />)} />
          </ErrorBoundary>
        );
      }
    }

    const app = await getDOM<Outside>(<Outside />);
    await app.settle();
    expect(shown(app.container)).toEqual({ ok: 2, panels: 1, caught: [] });

    app.instance.badId = "b";
    await app.settle();
    expect(shown(app.container)).toEqual({ ok: 0, panels: 0, caught: ["boom"] });
  });

  /**
   * One boundary per row, inside the slot. The healthy sibling and the panel both survive, which is
   * what makes a per-row boundary worth the extra component: a list of independent things fails
   * independently.
   */
  test("a boundary per row replaces only the row that threw", async () => {
    class PerRow extends Component {
      @state rows = [{ id: "a" }, { id: "b" }];
      @state badId = "";
      render() {
        return (
          <Panel
            slot={list(this.rows, (row) => (
              <ErrorBoundary key={row.id} fallback={() => <i className="caught">one row</i>}>
                <Bomb boom={row.id === this.badId} />
              </ErrorBoundary>
            ))}
          />
        );
      }
    }

    const app = await getDOM<PerRow>(<PerRow />);
    await app.settle();
    expect(shown(app.container)).toEqual({ ok: 2, panels: 1, caught: [] });

    app.instance.badId = "b";
    await app.settle();
    expect(shown(app.container)).toEqual({ ok: 1, panels: 1, caught: ["one row"] });
  });
});

describe("who catches a throw from a displaced slot", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  class Bare extends Component<{ slot?: RamondaNode }> {
    render() {
      return <section>{this.props.slot}</section>;
    }
  }
  class Guarded extends Component<{ slot?: RamondaNode }> {
    render() {
      return (
        <ErrorBoundary fallback={() => <i className="caught">landing</i>}>
          <section>{this.props.slot}</section>
        </ErrorBoundary>
      );
    }
  }
  const Always = () => <Bomb boom />;
  const caught = (root: Element) => [...root.querySelectorAll(".caught")].map((node) => node.textContent);

  /**
   * This one looks like the exception and is the rule: the writer's boundary catches because the
   * writer rendered the landing component, so it IS above where the slot went.
   */
  test("only the writer guards, so the writer catches", async () => {
    class WriterGuards extends Component {
      render() {
        return (
          <ErrorBoundary fallback={() => <i className="caught">writer</i>}>
            <Bare slot={<Always />} />
          </ErrorBoundary>
        );
      }
    }

    const app = await getDOM<WriterGuards>(<WriterGuards />);
    await app.settle();
    expect(caught(app.container)).toEqual(["writer"]);
  });

  test("only the landing place guards, and nothing above it does", async () => {
    class LanderGuards extends Component {
      render() {
        return <Guarded slot={<Always />} />;
      }
    }

    const app = await getDOM<LanderGuards>(<LanderGuards />);
    await app.settle();
    expect(caught(app.container)).toEqual(["landing"]);
  });

  /** Both guard, and the nearer one to where it LANDED wins — not the nearer one to where it was typed. */
  test("both guard, and the landing place is the nearer", async () => {
    class BothGuard extends Component {
      render() {
        return (
          <ErrorBoundary fallback={() => <i className="caught">writer</i>}>
            <Guarded slot={<Always />} />
          </ErrorBoundary>
        );
      }
    }

    const app = await getDOM<BothGuard>(<BothGuard />);
    await app.settle();
    expect(caught(app.container)).toEqual(["landing"]);
  });
});

describe("a boundary around an AsyncLoad", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  class Exploding extends Component {
    render(): never {
      throw new Error("render boom");
    }
  }
  class Fine extends Component<{ text: string }> {
    render() {
      return <b className="ok">{this.props.text}</b>;
    }
  }

  const resolvers: Record<string, (module: Record<string, unknown>) => void> = {};
  const lazies: Record<string, () => Promise<Record<string, unknown>>> = {};
  const lazyFor = (id: string) => {
    lazies[id] ??= () =>
      new Promise((resolve) => {
        resolvers[id] = resolve;
      });
    return lazies[id];
  };
  const flush = async (app: { settle: () => Promise<unknown> }) => {
    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
      await app.settle();
    }
  };

  /**
   * The two failures an `AsyncLoad` can have are not the same failure, and only one of them is its
   * own. A load that REJECTS is `errorFallback`'s — the module never arrived. A module that arrives
   * and then throws while rendering is an ordinary render throw, and belongs to the boundary. Both
   * are asserted here, because a component that answered its own fallback for the second would
   * swallow a real error behind "load failed".
   */
  test("a module that throws while rendering goes to the boundary, not to errorFallback", async () => {
    class App extends Component {
      @state rows = [{ id: "x1" }, { id: "x2" }];
      render() {
        return (
          <ErrorBoundary fallback={({ message }) => <i className="caught">{message}</i>}>
            <Panel
              slot={list(this.rows, (row) => (
                <AsyncLoad
                  key={row.id}
                  lazy={lazyFor(row.id)}
                  cacheKey={row.id}
                  onLoading={<i className="wait">…</i>}
                  errorFallback={<i className="err">load failed</i>}
                  loadedProps={{ text: row.id }}
                />
              ))}
            />
          </ErrorBoundary>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    resolvers.x1({ default: Exploding });
    resolvers.x2({ default: Fine });
    await flush(app);

    expect({
      caught: [...app.container.querySelectorAll(".caught")].map((node) => node.textContent),
      loadFallbacks: app.container.querySelectorAll(".err").length,
      panels: app.container.querySelectorAll(".panel").length,
    }).toEqual({ caught: ["render boom"], loadFallbacks: 0, panels: 0 });
  });
});

describe("reset", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  /** The fallback's `reset` is what makes a boundary a recovery and not just a gravestone. */
  test("a boundary that caught can be sent back to its children", async () => {
    class Resettable extends Component {
      @state bad = true;
      render() {
        return (
          <ErrorBoundary
            fallback={({ reset }) => (
              <button className="caught" onclick={reset}>
                retry
              </button>
            )}
          >
            {this.bad ? <Bomb boom /> : <b className="ok">recovered</b>}
          </ErrorBoundary>
        );
      }
    }

    const app = await getDOM<Resettable>(<Resettable />);
    await app.settle();
    expect(shown(app.container)).toEqual({ ok: 0, panels: 0, caught: ["retry"] });

    app.instance.bad = false;
    (app.container.querySelector(".caught") as HTMLElement).click();
    await app.settle();

    expect(shown(app.container)).toEqual({ ok: 1, panels: 0, caught: [] });
  });
});
