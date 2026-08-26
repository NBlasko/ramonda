import { describe, test, expect } from "vitest";
import { getDOM, findAll } from "../test/setup";
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

class Page extends Component {
  @state tick = 0;
  /** A plain field: an element is not state, and the tick is what re-runs the factory. */
  slot: Element | undefined;

  portal = this.use(Portal, (self: Page) => ({
    children: <Pinned />,
    target: self.tick >= 0 ? self.slot : undefined,
  }));

  @mounted({ env: "client" }) aim() {
    this.slot = document.querySelector("#slot") ?? undefined;
    this.tick++;
  }

  render() {
    return (
      <div id="body">
        <section id="slot" />
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
});
