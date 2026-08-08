import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, Hook, state, compute, watchProp, createContext, list } from "../index";
import { renderToString } from "../hydration/ssr";
import { effectLike } from "../test/effectLike";

/**
 * The reactive graph, probed across the ways its pieces reach each other.
 *
 * Written after a `@compute` reading another `@compute` turned out never to
 * invalidate — a stale number on screen, no error, and it had been there a long
 * time. That is the shape of failure this layer produces, so the combinations
 * are enumerated deliberately rather than left to whatever a feature test
 * happens to exercise.
 */

describe("reactivity graph", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("an effect re-runs when a @compute it reads changes", async () => {
    const seen: number[] = [];

    @Host("div")
    class C extends Component {
      @state n = 1;
      @compute get double() {
        return this.n * 2;
      }
      @effectLike() track() {
        seen.push(this.double);
      }
      render() {
        return <span>{this.n}</span>;
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();
    app.instance.n = 5;
    await app.settle();

    expect(seen).toEqual([2, 10]);
  });

  test("a @compute over context updates, and context fed by a @compute updates", async () => {
    const [Provider, Ctx] = createContext({ theme: "light" });

    @Host("div")
    class Child extends Component {
      ctx = this.use(Ctx);
      @compute get loud() {
        return this.ctx.theme.toUpperCase();
      }
      render() {
        return <span>{this.loud}</span>;
      }
    }

    @Host("div")
    class App extends Component {
      @state base = "light";
      @compute get decorated() {
        return `${this.base}!`;
      }
      p = this.use(Provider, () => ({ theme: this.decorated }));
      render() {
        return <Child />;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(app.container.textContent).toBe("LIGHT!");

    // A compute feeds the provider, and another compute reads it back out.
    app.instance.base = "dark";
    await app.settle();
    expect(app.container.textContent).toBe("DARK!");
  });

  test("a @compute in a hook follows another hook's state", async () => {
    class Inner extends Hook {
      @state v = 1;
    }
    class Outer extends Hook {
      inner = this.use(Inner);
      @compute get doubled() {
        return this.inner.v * 2;
      }
    }

    @Host("div")
    class C extends Component {
      outer = this.use(Outer);
      render() {
        return <span>{this.outer.doubled}</span>;
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();
    app.instance.outer.inner.v = 4;
    await app.settle();

    expect(app.container.textContent).toBe("8");
  });

  test("@watchProp fires for a prop that came from a @compute", async () => {
    const seen: number[] = [];

    @Host("div")
    class Child extends Component<{ value: number }> {
      @watchProp((p: { value: number }) => p.value)
      onValue([next]: [number]) {
        seen.push(next);
      }
      render() {
        return <span>{this.props.value}</span>;
      }
    }

    @Host("div")
    class App extends Component {
      @state n = 1;
      @compute get double() {
        return this.n * 2;
      }
      render() {
        return <Child value={this.double} />;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    app.instance.n = 5;
    await app.settle();

    expect(seen).toEqual([10]);
  });

  test("a diamond recomputes once, not once per branch", async () => {
    let joins = 0;

    @Host("div")
    class C extends Component {
      @state n = 1;
      @compute get left() {
        return this.n + 1;
      }
      @compute get right() {
        return this.n * 10;
      }
      @compute get both() {
        joins++;
        return `${this.left}/${this.right}`;
      }
      render() {
        return <span>{this.both}</span>;
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();
    const atMount = joins;

    app.instance.n = 3;
    await app.settle();

    expect(app.container.textContent).toBe("4/30");
    expect(joins - atMount).toBe(1);
  });

  test("a @compute drops the branch it stopped reading", async () => {
    let runs = 0;

    @Host("div")
    class C extends Component {
      @state useX = true;
      @state x = "x1";
      @state y = "y1";
      @compute get pick() {
        runs++;
        return this.useX ? this.x : this.y;
      }
      render() {
        return <span>{this.pick}</span>;
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();
    const atMount = runs;

    // Writing the branch it does NOT read must not invalidate it.
    app.instance.y = "y2";
    await app.settle();
    expect(runs).toBe(atMount);
    expect(app.container.textContent).toBe("x1");

    app.instance.useX = false;
    await app.settle();
    expect(app.container.textContent).toBe("y2");

    // And the branch it abandoned must stop reaching it.
    app.instance.x = "x9";
    await app.settle();
    expect(app.container.textContent).toBe("y2");

    app.instance.y = "y3";
    await app.settle();
    expect(app.container.textContent).toBe("y3");
  });

  test("an effect drops a dependency it stopped reading", async () => {
    const seen: string[] = [];

    @Host("div")
    class C extends Component {
      @state useX = true;
      @state x = "x1";
      @state y = "y1";
      @effectLike() watch() {
        seen.push(this.useX ? this.x : this.y);
      }
      render() {
        return <span>{this.useX ? "X" : "Y"}</span>;
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();

    app.instance.y = "y2";
    await app.settle();
    expect(seen).toEqual(["x1"]);

    app.instance.useX = false;
    await app.settle();
    app.instance.x = "x9";
    await app.settle();
    expect(seen).toEqual(["x1", "y2"]);
  });

  test("a list item's scope drops a dependency it stopped reading", async () => {
    let mapperRuns = 0;

    @Host("div")
    class C extends Component {
      @state rows = [{ t: "a" }];
      @state useFlag = true;
      @state flag = "F1";
      @state other = "O1";
      render() {
        return (
          <ul>
            {list({
              each: this.rows,
              render: (row: { t: string }) => {
                mapperRuns++;
                return (
                  <li>
                    {row.t}-{this.useFlag ? this.flag : this.other}
                  </li>
                );
              },
            })}
          </ul>
        );
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();
    const atMount = mapperRuns;

    app.instance.other = "O2";
    await app.settle();
    expect(mapperRuns).toBe(atMount);

    app.instance.useFlag = false;
    await app.settle();
    expect(app.container.textContent).toBe("a-O2");

    app.instance.flag = "F9";
    await app.settle();
    expect(app.container.textContent).toBe("a-O2");
  });

  test("an unmounted component's effect stops running", async () => {
    const seen: number[] = [];

    @Host("div")
    class Child extends Component<{ n: number }> {
      @effectLike() watch() {
        seen.push(this.props.n);
      }
      render() {
        return <span>{this.props.n}</span>;
      }
    }

    @Host("div")
    class App extends Component {
      @state n = 1;
      @state show = true;
      render() {
        return <div>{this.show ? <Child n={this.n} /> : null}</div>;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    app.instance.show = false;
    await app.settle();
    app.instance.n = 99;
    await app.settle();

    expect(seen).toEqual([1]);
  });

  test("effects run in declaration order, so a later one sees an earlier one's write", async () => {
    const seen: string[] = [];

    @Host("div")
    class C extends Component {
      @state a = 1;
      @state b = 0;
      @effectLike() first() {
        this.b = this.a * 2;
      }
      @effectLike() second() {
        seen.push(`b=${this.b}`);
      }
      render() {
        return (
          <span>
            {this.a}/{this.b}
          </span>
        );
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();
    app.instance.a = 5;
    await app.settle();

    expect(app.container.textContent).toBe("5/10");
    // `b=0` never appears: `first` writes before `second` reads, on the same pass.
    expect(seen).toEqual(["b=2", "b=10"]);
  });

  test("a compute read outside render is still fresh", async () => {
    @Host("div")
    class C extends Component {
      @state n = 1;
      @compute get double() {
        return this.n * 2;
      }
      readIt() {
        return this.double;
      }
      render() {
        return <span>x</span>;
      }
    }

    const app = await getDOM<C>(<C />);
    await app.settle();
    expect(app.instance.readIt()).toBe(2);

    app.instance.n = 21;
    await app.settle();
    expect(app.instance.readIt()).toBe(42);
  });

  test("chained computes render on the server", async () => {
    @Host("div")
    class C extends Component {
      @state n = 7;
      @compute get double() {
        return this.n * 2;
      }
      @compute get quad() {
        return this.double * 2;
      }
      render() {
        return (
          <span>
            {this.double}-{this.quad}
          </span>
        );
      }
    }

    const html = await renderToString(<C />);
    expect(html).toContain("14");
    expect(html).toContain("28");
  });
});
