import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state, ShouldUpdateOnPropsChange } from "../index";

/**
 * Exactly what a refused props update leaves behind.
 *
 * `@ShouldUpdateOnPropsChange` returning `false` does not mean "take the props but
 * do not render". It means the update is **dropped whole**: `rawProps` is not
 * replaced, the prop signals are not written, and no render is scheduled. The
 * component goes on holding the props it last accepted.
 *
 * Which matters most in the case nobody expects — a render the component causes
 * ITSELF. Its own `@state` write re-renders it, and that render still reads the
 * old props, because nothing ever wrote the new ones anywhere.
 *
 * Nothing is lost permanently, though: the parent passes its CURRENT props every
 * time, so the next update the rule accepts carries everything that accumulated
 * while it was refusing. Delayed, not dropped.
 */
describe("a props update the rule refuses", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("the component does not receive the props at all", async () => {
    const seen: string[] = [];

    @ShouldUpdateOnPropsChange(
      (_self, previous: { id: string; noise: number }, next: { id: string; noise: number }) => previous.id !== next.id,
    )
    @Host("p")
    class Row extends Component<{ id: string; noise: number }> {
      render() {
        seen.push(`${this.props.id}/${this.props.noise}`);
        return (
          <span>
            {this.props.id}/{this.props.noise}
          </span>
        );
      }
    }

    @Host("div")
    class Board extends Component {
      @state id = "a";
      @state noise = 0;
      render() {
        return <Row id={this.id} noise={this.noise} />;
      }
    }

    const app = await getDOM<Board>(<Board />);
    await app.settle();
    expect(seen).toEqual(["a/0"]);

    // The rule says no: no render, and `noise` never reached the component.
    app.instance.noise = 1;
    await app.settle();
    expect(seen).toEqual(["a/0"]);
    expect(app.container.querySelector("span")!.textContent).toBe("a/0");
  });

  test("a render the component causes ITSELF still shows the old props", async () => {
    @ShouldUpdateOnPropsChange(() => false)
    @Host("p")
    class Row extends Component<{ label: string }> {
      @state clicks = 0;

      render() {
        return (
          <span>
            {this.props.label}/{this.clicks}
          </span>
        );
      }
    }

    @Host("div")
    class Board extends Component {
      @state label = "first";
      row = this.use as unknown; // not used; kept so the shape reads like an app
      render() {
        return <Row label={this.label} />;
      }
    }

    const app = await getDOM<Board>(<Board />);
    await app.settle();

    const row = app.container.querySelector("p") as { _componentInstance?: { clicks: number } };

    // The parent offers a new label; the rule refuses it.
    app.instance.label = "second";
    await app.settle();

    // The component now re-renders for its OWN reason.
    row._componentInstance!.clicks = 1;
    await app.settle();

    // The counter moved, the label did not — nothing ever wrote it.
    expect(app.container.querySelector("span")!.textContent).toBe("first/1");
  });

  test("the next accepted update carries everything refused in the meantime", async () => {
    const seen: string[] = [];

    @ShouldUpdateOnPropsChange(
      (_self, previous: { id: string; noise: number }, next: { id: string; noise: number }) => previous.id !== next.id,
    )
    @Host("p")
    class Row extends Component<{ id: string; noise: number }> {
      render() {
        seen.push(`${this.props.id}/${this.props.noise}`);
        return <span>x</span>;
      }
    }

    @Host("div")
    class Board extends Component {
      @state id = "a";
      @state noise = 0;
      render() {
        return <Row id={this.id} noise={this.noise} />;
      }
    }

    const app = await getDOM<Board>(<Board />);
    await app.settle();

    app.instance.noise = 1;
    await app.settle();
    app.instance.noise = 2;
    await app.settle();

    // Still on the first props.
    expect(seen).toEqual(["a/0"]);

    // An update the rule accepts — and `noise` arrives with it, at its CURRENT
    // value, because the parent passes what it has now rather than a queue of
    // what it tried.
    app.instance.id = "b";
    await app.settle();

    expect(seen).toEqual(["a/0", "b/2"]);
  });
});
