import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component, list, Portal } from "../index";
import { state } from "../base/decorators";
import { getDOM } from "../test/setup";
import { scanComponentTree, type InspectedNode } from "../debug/inspector";
import type { RamondaNode } from "../types/vdom";

/**
 * Queue item 8, and the last of the campaign: the panel's view of everything items 3 to 7 move.
 *
 * The inspector is the one thing here that watches rather than renders, and it reads the CHILD
 * RECORD rather than walking the DOM — it has to, because a component owns a range of nodes and may
 * own none at all. So it can be wrong in a way nothing else notices: the page stays correct while
 * the panel shows a tree nobody is looking at, rows in an order they are not in, or a component that
 * unmounted three renders ago.
 *
 * What is asserted is the SHAPE and the ORDER together — names alone pass while two rows are
 * swapped, since both are called `Leaf`.
 */
class Leaf extends Component<{ text: string }> {
  render() {
    return <b className="leaf">{this.props.text}</b>;
  }
}

/** Renders a slot, so the rows land somewhere other than where they were written. */
class Panel extends Component<{ slot?: RamondaNode }> {
  render() {
    return <section>{this.props.slot}</section>;
  }
}

class Modal extends Component {
  render() {
    return <div id="modal">m</div>;
  }
}

class App extends Component {
  @state rows = [{ id: "a" }, { id: "b" }];
  @state modalOpen = false;
  portal = this.use(Portal, (self: App) => ({
    target: document.body,
    children: self.modalOpen ? <Modal /> : null,
  }));
  render() {
    return <Panel slot={list(this.rows, (row) => <Leaf key={row.id} text={row.id} />)} />;
  }
}

/** The tree as a panel would draw it: indented, and naming which row is which. */
const drawn = (root: Element | Document | Node): string[] => {
  const out: string[] = [];
  const walk = (nodes: InspectedNode[], depth: number): void => {
    for (const node of nodes) {
      const text = (node.props as { text?: string } | undefined)?.text;
      out.push(`${"  ".repeat(depth)}${node.name}${text ? `(${text})` : ""}`);
      walk(node.children, depth + 1);
    }
  };
  walk(scanComponentTree(root as Node), 0);
  return out;
};

describe("the panel's view while the tree moves", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  /**
   * Rows written in `App` and rendered by `Panel` are drawn under PANEL — the same rule lifecycle,
   * context and error handling follow. A panel that drew them where they were typed would put them
   * under `App`, and every one of those four rules would disagree with the picture.
   */
  test("a slot's contents are drawn where they land", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();

    expect(drawn(app.container)).toEqual(["App", "  Panel", "    Leaf(a)", "    Leaf(b)"]);
  });

  test("a reorder is drawn in the new order", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.rows = [{ id: "b" }, { id: "a" }];
    await app.settle();

    expect(drawn(app.container)).toEqual(["App", "  Panel", "    Leaf(b)", "    Leaf(a)"]);
  });

  /**
   * A dropped row leaves the picture. The record is what the panel reads, so a row whose entry was
   * retired without being removed would go on being drawn — a component the page has forgotten,
   * still listed with its state readable.
   */
  test("a dropped row leaves the picture", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.rows = [{ id: "b" }];
    await app.settle();

    expect(drawn(app.container)).toEqual(["App", "  Panel", "    Leaf(b)"]);
  });

  /**
   * A portalled component is drawn where its NODES are, not under whoever declared it — which is
   * the panel's own rule, and the opposite of the slot rule above. The two are not in conflict: a
   * slot's content really is rendered by the component it lands in, while a portal's content is
   * rendered into a target that belongs to nobody.
   *
   * Scanned from the container it is absent, because its nodes are not there; scanned from the body
   * it is a root beside `App`. Both are asserted, since only the pair says WHERE it went.
   */
  test("a portal's contents are drawn where their nodes are", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(drawn(document.body)).not.toContain("Modal");

    app.instance.modalOpen = true;
    await app.settle();

    expect(drawn(app.container)).toEqual(["App", "  Panel", "    Leaf(a)", "    Leaf(b)"]);
    expect(drawn(document.body)).toEqual(["Modal", "App", "  Panel", "    Leaf(a)", "    Leaf(b)"]);

    app.instance.modalOpen = false;
    await app.settle();
    expect(drawn(document.body)).not.toContain("Modal");
  });
});
