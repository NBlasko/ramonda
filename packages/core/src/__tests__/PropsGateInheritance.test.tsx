import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state, ShouldUpdateOnPropsChange } from "../index";

/**
 * `@ShouldUpdateOnPropsChange` — the rule a component follows when its parent
 * hands it new props, and what happens to that rule under `extends`.
 *
 * It is a CLASS decorator because it describes what the component IS rather than
 * something it does: exactly one answer per class, no body to override with
 * `super`, and the same shape as `@Host`'s tag-from-props callback. Its `self` is
 * inferred from the class it is written on, so nothing has to be annotated.
 *
 * As a method decorator it had two faults that this form cannot have. A subclass
 * overriding the decorated METHOD without re-decorating ran the base's body,
 * because the function was captured at decoration time — there is no method to
 * capture now. And declaring it at both levels, the ordinary way to override a
 * rule, was reported as "more than one" — the class that owns the declaration is
 * now visible (`Object.hasOwn`), so an override is silent and a genuine
 * double-application on one class is not.
 */
describe("@ShouldUpdateOnPropsChange", () => {
  const logged: string[] = [];

  beforeEach(() => {
    logged.length = 0;
    // ramondaLog prints through console.log whatever the severity.
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  /**
   * Matched on the CODE, not on a phrase.
   *
   * The report is `RMD040` now rather than a bare message, and a filter on prose is a filter that
   * stops matching when somebody rewords the sentence — silently, since an empty result reads the same
   * as "nothing was reported". The code is the part that is promised to be stable.
   */
  const duplicateReports = () => logged.filter((line) => line.includes("RMD040"));

  test("refusing an update keeps the old props on screen", async () => {
    const seen: string[] = [];

    @ShouldUpdateOnPropsChange((_self, previous, next) => {
      seen.push(`${previous.v}->${next.v}`);
      return false;
    })
    @Host("b")
    class Gated extends Component<{ v: number }> {
      render() {
        return <i>{this.props.v}</i>;
      }
    }

    @Host("div")
    class App extends Component {
      @state v = 1;
      render() {
        return (
          <div>
            <Gated v={this.v} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.v = 2;
    await app.settle();

    expect(seen).toEqual(["1->2"]);
    expect(app.container.querySelector("i")!.textContent).toBe("1");
  });

  test("taking the update lets the new props through, and `self` is the instance", async () => {
    let sawSelf: unknown;

    @ShouldUpdateOnPropsChange((self, _previous, next) => {
      sawSelf = self;
      return next.v !== self.floor;
    })
    @Host("b")
    class Gated extends Component<{ v: number }> {
      floor = 99;
      render() {
        return <i>{this.props.v}</i>;
      }
    }

    @Host("div")
    class App extends Component {
      @state v = 1;
      render() {
        return (
          <div>
            <Gated v={this.v} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.v = 2;
    await app.settle();

    expect(app.container.querySelector("i")!.textContent).toBe("2");
    expect((sawSelf as { floor: number }).floor).toBe(99);
  });

  test("a subclass inherits the rule without redeclaring it", async () => {
    @ShouldUpdateOnPropsChange(() => false)
    @Host("b")
    class Base extends Component<{ v: number }> {
      render() {
        return <i>{this.props.v}</i>;
      }
    }

    class Sub extends Base {
      override render() {
        return <u>{this.props.v}</u>;
      }
    }

    @Host("div")
    class App extends Component {
      @state v = 1;
      render() {
        return (
          <div>
            <Sub v={this.v} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.v = 2;
    await app.settle();

    expect(app.container.querySelector("u")!.textContent).toBe("1");
    expect(duplicateReports()).toEqual([]);
  });

  test("a subclass redeclaring it overrides the base, with nothing reported", async () => {
    @ShouldUpdateOnPropsChange(() => false)
    @Host("b")
    class Base extends Component<{ v: number }> {
      render() {
        return <i>{this.props.v}</i>;
      }
    }

    @ShouldUpdateOnPropsChange(() => true)
    @Host("b")
    class Sub extends Base {
      override render() {
        return <u>{this.props.v}</u>;
      }
    }

    @Host("div")
    class App extends Component {
      @state v = 1;
      render() {
        return (
          <div>
            <Base v={this.v} />
            <Sub v={this.v} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.v = 2;
    await app.settle();

    // The base still refuses; the subclass takes.
    expect(app.container.querySelector("i")!.textContent).toBe("1");
    expect(app.container.querySelector("u")!.textContent).toBe("2");
    expect(duplicateReports()).toEqual([]);
  });

  /**
   * Which of the two decides, measured — because it reads backwards and `RMD040`'s advice names it.
   *
   * Class decorators are APPLIED bottom-up, and the write is unconditional, so the lower declaration
   * writes the rule and the upper one overwrites it: the one written FURTHEST from the class is the one
   * that answers. Asserted here rather than reasoned about in a comment, since the whole value of the
   * advice is that it points at the declaration that is actually in effect.
   */
  test("applying it twice to ONE class is reported, and the furthest one decides", async () => {
    const asked: string[] = [];

    @ShouldUpdateOnPropsChange(() => {
      asked.push("furthest");
      return true;
    })
    @ShouldUpdateOnPropsChange(() => {
      asked.push("closest");
      return false;
    })
    @Host("b")
    class Twice extends Component<{ v: number }> {
      render() {
        return <i>{this.props.v}</i>;
      }
    }

    @Host("div")
    class App extends Component {
      @state v = 1;
      render() {
        return (
          <div>
            <Twice v={this.v} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    app.instance.v = 2;
    await app.settle();

    expect(duplicateReports().length).toBe(1);
    // Only one was ever consulted, and it is the far one — so the near one's `false` never refuses.
    expect(asked).toEqual(["furthest"]);
    expect(app.container.querySelector("i")!.textContent).toBe("2");
  });

  test("the order the class decorators are written in does not matter", async () => {
    // Class decorators EVALUATE top-to-bottom and APPLY bottom-to-top. That is
    // invisible here only because each writes its own slot on the constructor and
    // reads nothing another wrote — a rule worth keeping, because the day one
    // reads another's, the order becomes load-bearing and nothing in the source
    // says so.
    @ShouldUpdateOnPropsChange(() => false)
    @Host("b")
    class GateFirst extends Component<{ v: number }> {
      render() {
        return <i>{this.props.v}</i>;
      }
    }

    @Host("b")
    @ShouldUpdateOnPropsChange(() => false)
    class HostFirst extends Component<{ v: number }> {
      render() {
        return <u>{this.props.v}</u>;
      }
    }

    @Host("div")
    class App extends Component {
      @state v = 1;
      render() {
        return (
          <div>
            <GateFirst v={this.v} />
            <HostFirst v={this.v} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    // Same host element either way…
    expect(app.container.querySelectorAll("b").length).toBe(2);

    app.instance.v = 2;
    await app.settle();

    // …and the same rule either way.
    expect(app.container.querySelector("i")!.textContent).toBe("1");
    expect(app.container.querySelector("u")!.textContent).toBe("1");
    expect(duplicateReports()).toEqual([]);
  });
});
