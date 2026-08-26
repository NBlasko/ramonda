import { describe, test, expect } from "vitest";
import { getDOM, findAll, servedMarkup } from "../test/setup";
import { state, destroyed, mounted } from "../base/decorators";
import { Component } from "../base/Component";
import { Portal } from "../base/Portal";

/**
 * A `Portal` aimed at an element in the owner's OWN render — which is how "inline" is done, and
 * documented as such in `base/Portal.ts`: there is no `disabled` flag, because a hook has no
 * position of its own, so a portal that should render in place aims its target at a node the owner
 * renders.
 *
 * The element then holds a block it does not own. Its own record says nothing about it — a block
 * keeps its record on its opening anchor, because a target is shared and cannot be any one
 * region's — so an element diff that seeds its claim pool from `childNodes` reads the whole block as
 * its own leftovers: the anchors, the nodes, and, through `releaseChildRecord` on the anchor, the
 * components inside it, whose `@destroyed` runs while the portal still believes them mounted.
 */

const gone: string[] = [];

class Pinned extends Component {
  @state n = 0;
  @destroyed bye() {
    gone.push("Pinned");
  }
  render() {
    return <span id="pin">pin{String(this.n)}</span>;
  }
}

class Own extends Component {
  render() {
    return <b id="own">own</b>;
  }
}

class Page extends Component {
  @state tick = 0;
  /**
   * A plain field, and the tick is what re-runs the props factory — a target change is noticed
   * through the same `children` signal. It starts detached because the element this portal is aimed
   * at does not exist until the first render has produced it.
   */
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
        <section id="slot">
          <Own />
        </section>
        <p id="t">{String(this.tick)}</p>
      </div>
    );
  }
}

describe("a portal aimed inside its owner's render", () => {
  test("survives the owner re-rendering the element it lives in", async () => {
    const app = await getDOM<Page>(<Page />);
    await app.settle();
    gone.length = 0;

    const slot = app.container.querySelector("#slot")!;
    expect(slot.querySelector("#pin")!.textContent).toBe("pin0");
    const pinnedNode = slot.querySelector("#pin")!;

    // An ordinary re-render of the owner, which walks the element the block sits in.
    app.instance.tick++;
    await app.settle();

    expect(app.container.querySelector("#t")!.textContent).toBe("2");
    // The block is untouched: the same node, the same instance, nothing destroyed.
    expect(slot.querySelector("#pin")).toBe(pinnedNode);
    expect(gone).toEqual([]);
    expect(findAll<Pinned>(app.container, "Pinned")).toHaveLength(1);

    // And still live: the component inside re-renders into its own block.
    findAll<Pinned>(app.container, "Pinned")[0]!.n = 7;
    await app.settle();
    expect(slot.querySelector("#pin")!.textContent).toBe("pin7");
  });

  test("survives the element momentarily owning no region of its own", async () => {
    /**
     * The element's record is kept only while it still owns a region, so a render where its own
     * component disappears DELETES it — and the next render that brings one back reads `childNodes`
     * instead. That fallback had no block skip: the whole portal became the render's leftovers.
     *
     * Measured before the fix: `#pin` gone from the page, `@destroyed` run for the portalled
     * component while the `Portal` still held its region, and the region's next reorder throwing
     * `NotFoundError` on its own detached closing anchor.
     *
     * The same fallback is taken on the render an element gains its FIRST region, which needs no
     * toggle at all — this is the shape that also covers it.
     */
    class Toggling extends Component {
      @state tick = 0;
      @state show = true;
      slot: Element = document.createElement("div");

      portal = this.use(Portal, (self: Toggling) => ({
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
            <section id="slot">{this.show ? <Own /> : null}</section>
            <p id="t">{String(this.tick)}</p>
          </div>
        );
      }
    }

    const app = await getDOM<Toggling>(<Toggling />);
    await app.settle();
    gone.length = 0;

    const slot = app.container.querySelector("#slot")!;
    const pinNode = slot.querySelector("#pin")!;
    expect(pinNode).not.toBeNull();

    // Its own component goes: the element stops owning a region and its record is dropped.
    app.instance.show = false;
    await app.settle();
    expect(slot.querySelector("#pin")).toBe(pinNode);

    // And comes back, on the render that reads the DOM instead of a record.
    app.instance.show = true;
    await app.settle();

    expect(slot.querySelector("#own")).not.toBeNull();
    expect(slot.querySelector("#pin")).toBe(pinNode);
    expect(gone).toEqual([]);
    expect(findAll<Pinned>(app.container, "Pinned")).toHaveLength(1);

    // Still the region's own: a refresh that changes its length reorders against a live anchor.
    findAll<Pinned>(app.container, "Pinned")[0]!.n = 5;
    await app.settle();
    expect(slot.querySelector("#pin")!.textContent).toBe("pin5");
  });

  test("the server's markers wrap each range without swallowing the block", async () => {
    /**
     * The element that hosts the block also has a record of its own, and the marker pass walks
     * BACKWARDS from the end of the parent — so a component whose nodes come before the block would
     * put its closing marker past the block's anchors and read the whole block as part of its own
     * range. The pass reaches a block where it is published, on its opening anchor, and marks it
     * within its own bounds.
     */
    const app = await getDOM<Page>(<Page />);
    await app.settle();

    const slot = app.container.querySelector("#slot")!;
    const markup = servedMarkup(slot as HTMLElement, { state: false }).replace(/r\d+/g, "rN");

    /**
     * Its own component's markers, then the block's anchors with the portalled component's markers
     * inside them. Neither pair straddles the other — which is the claim; the numbering is not, and
     * the block is numbered first because the pass reaches it first. Nothing matches on the number.
     */
    expect(markup).toBe(
      '<!--c1--><b id="own">own</b><!--/c1--><!--rN--><!--c0--><span id="pin">pin0</span><!--/c0--><!--/rN-->',
    );
  });
});
