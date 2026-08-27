import { describe, test, expect } from "vitest";
import { getDOM, findAll } from "../test/setup";
import { state, mounted } from "../base/decorators";
import { Component } from "../base/Component";
import { Portal } from "../base/Portal";

/**
 * Shapes the diff handles that nothing was asking it to.
 *
 * Each of these was found by reading the coverage report for lines the whole suite never executes,
 * rather than by a failure — so they are written as claims about behaviour, not as regressions. A
 * line no test reaches is a line the next change may quietly break.
 */

describe("an element that hosts a block but keeps no record of its own", () => {
  /**
   * The no-region path: this element's children are all plain markup, so the diff seeds its claim
   * pool from `childNodes` rather than from a record. A `Portal` aimed at it puts a block in there
   * anyway — anchors, nodes and all — and none of it is this element's to claim or to remove.
   *
   * The path that skips it had no test at this level: the covered case put a component in the same
   * element, which sends the diff down the record path instead.
   */
  test("its own children still diff, and the block is untouched", async () => {
    class Pinned extends Component {
      @state n = 0;
      render() {
        return <span id="pin">pin{String(this.n)}</span>;
      }
    }

    class Page extends Component {
      @state tick = 0;
      slot: Element = document.createElement("div");

      portal = this.use(Portal, (self: Page) => ({
        children: <Pinned />,
        target: self.tick >= 0 ? self.slot : self.slot,
      }));

      @mounted({ env: "client" }) aim() {
        const found = document.querySelector("#slot");
        if (found) this.slot = found;
        this.tick++;
      }

      render() {
        return (
          <div id="body">
            {/* Plain markup only: no component here, so this element keeps no record. */}
            <section id="slot">
              <b id="own">own {String(this.tick)}</b>
            </section>
          </div>
        );
      }
    }

    const app = await getDOM<Page>(<Page />);
    await app.settle();

    const slot = app.container.querySelector("#slot")!;
    const ownNode = slot.querySelector("#own")!;
    const pinNode = slot.querySelector("#pin")!;
    expect(pinNode).not.toBeNull();

    app.instance.tick++;
    await app.settle();

    // Its own child was patched in place …
    expect(slot.querySelector("#own")).toBe(ownNode);
    expect(slot.querySelector("#own")!.textContent).toBe("own 2");
    // … and the block is the same nodes, still live.
    expect(slot.querySelector("#pin")).toBe(pinNode);
    findAll<Pinned>(app.container, "Pinned")[0]!.n = 3;
    await app.settle();
    expect(slot.querySelector("#pin")!.textContent).toBe("pin3");
  });
});

describe("a prop that disappears between renders", () => {
  /**
   * `<Card note="hi" />` and then `<Card />`. The signal behind `note` is not deleted — a render
   * reading it must see `undefined` rather than the value it had, or a component keeps showing a
   * prop its caller has stopped passing.
   */
  test("reads as undefined rather than keeping its last value", async () => {
    class Card extends Component<{ note?: string }> {
      render() {
        return <p id="card">{this.props.note ?? "(none)"}</p>;
      }
    }

    class Shell extends Component {
      @state withNote = true;
      render() {
        return <div id="shell">{this.withNote ? <Card note="hi" /> : <Card />}</div>;
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    expect(app.container.querySelector("#card")!.textContent).toBe("hi");
    const cardNode = app.container.querySelector("#card")!;

    app.instance.withNote = false;
    await app.settle();

    expect(app.container.querySelector("#card")!.textContent).toBe("(none)");
    // The same instance and the same node: the prop went, the component did not.
    expect(app.container.querySelector("#card")).toBe(cardNode);
  });
});

describe("the slot search walks backwards as well as forwards", () => {
  /**
   * A child's SLOT is its position among its parent's JSX children, counting the ones that render
   * nothing. When a conditional sibling ABOVE a child disappears, that child's node is now EARLIER
   * in the pool than the position the diff guesses — so the search has to step backwards, and stop
   * the moment it passes a slot lower than the one it wants.
   *
   * The forward half of that search is exercised constantly; the backward half was not.
   */
  test("a child keeps its own node when a sibling above it goes away", async () => {
    class Shell extends Component {
      @state lead = true;
      render() {
        return (
          <div id="shell">
            {this.lead ? <i id="lead">lead</i> : null}
            {this.lead ? <u id="second">second</u> : null}
            <b id="third">third</b>
            <b id="fourth">fourth</b>
          </div>
        );
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    const third = app.container.querySelector("#third")!;
    const fourth = app.container.querySelector("#fourth")!;

    app.instance.lead = false;
    await app.settle();

    expect(app.container.querySelector("#shell")!.innerHTML).toBe('<b id="third">third</b><b id="fourth">fourth</b>');
    // The very same nodes, not a neighbour's patched over: two `<b>` of the same shape are exactly
    // what a positional match would confuse.
    expect(app.container.querySelector("#third")).toBe(third);
    expect(app.container.querySelector("#fourth")).toBe(fourth);
  });
});
