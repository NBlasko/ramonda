import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state, shouldUpdateOnPropsChange } from "../index";

/**
 * The props gate under `extends`.
 *
 * Extending a component is a first-class pattern here — there are no fragments,
 * so inheritance is how behaviour is reused — and the gate has to behave the way
 * every other decorated method does when a subclass gets involved.
 *
 * Two things did not. Overriding the decorated method without re-decorating ran
 * the BASE's body, because the decorator kept the function it was handed at
 * decoration time rather than looking the method up on the instance the way the
 * lifecycle decorators do; the subclass's version was dead code that read as
 * live. And declaring the gate on both levels — the ordinary way to override a
 * rule — reported "more than one … remove the others", which is advice to break
 * working code, because the check could not tell a second declaration in ONE
 * class from an override in a subclass.
 */
describe("@shouldUpdateOnPropsChange and extends", () => {
  const logged: string[] = [];

  beforeEach(() => {
    logged.length = 0;
    // ramondaLog prints through console.log whatever the severity.
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const duplicateReports = () => logged.filter((line) => line.includes("more than one"));

  test("overriding the decorated method runs the subclass's body", async () => {
    const calls: string[] = [];

    class Base extends Component<{ v: number }> {
      @shouldUpdateOnPropsChange take() {
        calls.push("base");
        return false;
      }
      render() {
        return <i>{this.props.v}</i>;
      }
    }

    class Sub extends Base {
      // No decorator: the base already declared the role, this only changes the answer.
      override take() {
        calls.push("sub");
        return true;
      }
      override render() {
        return <b>{this.props.v}</b>;
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

    expect(calls).toEqual(["sub"]);
    // The override said "take them", so the new prop is on screen.
    expect(app.container.querySelector("b")!.textContent).toBe("2");
  });

  test("a subclass redeclaring the gate wins, and is not reported as a duplicate", async () => {
    const calls: string[] = [];

    class Base extends Component<{ v: number }> {
      @shouldUpdateOnPropsChange takeBase() {
        calls.push("base");
        return false;
      }
      render() {
        return <i>{this.props.v}</i>;
      }
    }

    class Sub extends Base {
      @shouldUpdateOnPropsChange takeSub() {
        calls.push("sub");
        return true;
      }
      override render() {
        return <b>{this.props.v}</b>;
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

    expect(calls).toEqual(["sub"]);
    expect(app.container.querySelector("b")!.textContent).toBe("2");
    expect(duplicateReports()).toEqual([]);
  });

  test("two gates in ONE class is still reported", async () => {
    class Twice extends Component<{ v: number }> {
      @shouldUpdateOnPropsChange first() {
        return false;
      }
      @shouldUpdateOnPropsChange second() {
        return false;
      }
      render() {
        return <i>{this.props.v}</i>;
      }
    }

    @Host("div")
    class App extends Component {
      render() {
        return (
          <div>
            <Twice v={1} />
          </div>
        );
      }
    }

    const app = await getDOM(<App />);
    await app.settle();

    expect(duplicateReports().length).toBe(1);
  });

  test("a gate inherited without being redeclared still applies", async () => {
    class Base extends Component<{ v: number }> {
      @shouldUpdateOnPropsChange take() {
        return false;
      }
      render() {
        return <i>{this.props.v}</i>;
      }
    }
    class Sub extends Base {
      override render() {
        return <b>{this.props.v}</b>;
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

    // The base said "refuse them", so the old prop is still on screen.
    expect(app.container.querySelector("b")!.textContent).toBe("1");
    expect(duplicateReports()).toEqual([]);
  });
});
