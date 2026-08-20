import { describe, expect, test } from "vitest";
import { Component } from "../../base/Component";
import { compute, mounted, state } from "../../base/decorators";
import { getDOM } from "../../test/setup";

/**
 * What `@compute` on `render` does once the development guard is stripped.
 *
 * `assertNotRender` refuses it in development, so this is the only run that can see the other side. It
 * matters because the answer CHANGED: while `@compute` installed an accessor for a method, `render` stopped
 * being callable and the page died with `component.render is not a function` — loud, immediate, before
 * anything appeared. The method form installs a function now, so that crash is gone.
 *
 * What replaced it is worse in the way that matters: the render is CACHED on the signals it read, so it
 * keeps working for state and props — measured — and freezes on anything it read that is not a signal. A
 * plain field is the ordinary case, and the control below is the same component without the decorator: it
 * shows the new value where the computed one shows the old.
 *
 * So the guard's reason is no longer "it crashes". It is that this fails silently.
 *
 * **And the type does not refuse it** — measured: `@compute render()` needs no `@ts-expect-error` here,
 * because `render` takes no parameter and returns a value, which is exactly the shape `compute` accepts.
 * `assertNotRender` is the only net, and it is stripped from production. That is the whole reason this file
 * exists rather than a claim in a comment.
 */

let computed: Computed | undefined;
let control: Control | undefined;

class Computed extends Component<{ tick: number }> {
  plain = "old";
  @mounted grab() {
    computed = this;
  }
  @compute
  render() {
    return <span>{this.plain}</span>;
  }
}

class Control extends Component<{ tick: number }> {
  plain = "old";
  @mounted grab() {
    control = this;
  }
  render() {
    return <span>{this.plain}</span>;
  }
}

class Host extends Component<{ which: "computed" | "control" }> {
  @state tick = 0;
  render() {
    return <div>{this.props.which === "computed" ? <Computed tick={this.tick} /> : <Control tick={this.tick} />}</div>;
  }
}

describe("@compute on render, with no guard in the way", () => {
  test("a state write still reaches the DOM, because a signal is tracked", async () => {
    class Reactive extends Component {
      @state n = 1;
      @compute
      render() {
        return <span>{String(this.n)}</span>;
      }
    }

    using app = await getDOM<Reactive>(<Reactive />);
    expect(app.container.textContent).toBe("1");
    app.instance.n = 2;
    await app.settle();
    expect(app.container.textContent).toBe("2");
  });

  test("and so does a props change", async () => {
    class Leaf extends Component<{ label: string }> {
      @compute
      render() {
        return <span>{this.props.label}</span>;
      }
    }
    class Above extends Component {
      @state label = "a";
      render() {
        return (
          <div>
            <Leaf label={this.label} />
          </div>
        );
      }
    }

    using app = await getDOM<Above>(<Above />);
    expect(app.container.textContent).toBe("a");
    app.instance.label = "b";
    await app.settle();
    expect(app.container.textContent).toBe("b");
  });

  test("a PLAIN field freezes the page, where a plain render would not", async () => {
    control = undefined;
    using plain = await getDOM<Host>(<Host which="control" />);
    expect(control).toBeDefined();
    control!.plain = "new";
    plain.instance.tick = 1;
    await plain.settle();
    // The control: `render()` re-runs on every commit, so it re-reads the field.
    expect(plain.container.textContent).toBe("new");

    computed = undefined;
    using cached = await getDOM<Host>(<Host which="computed" />);
    expect(computed).toBeDefined();
    computed!.plain = "new";
    cached.instance.tick = 1;
    await cached.settle();
    // The computed render never re-ran: nothing it read had moved, because a plain field is not a signal.
    expect(cached.container.textContent).toBe("old");
  });
});
