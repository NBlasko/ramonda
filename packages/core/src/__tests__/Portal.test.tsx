import { describe, test, expect, beforeEach } from "vitest";
import { Component } from "../base/Component";
import { state, created, mounted, destroyed } from "../base/decorators";
import { Portal } from "../base/Portal";
import { State } from "../reactivity/State";
import { bootstrap } from "../index";
import { createRef } from "../base/Ref";
import { ChildrenRegion } from "../core/childrenRegion";
import { portalTarget, PORTAL_TARGET_ATTR } from "../base/portalTarget";
import { list } from "../base/list";
import { getDOM, findAll } from "../test/setup";
import { resetDiagnostics } from "../debug/diagnostics";
import type { RamondaNode } from "../types/vdom";

/**
 * `Portal` — renders a subtree into a DOM target elsewhere (its whole reason to
 * exist), while the subtree stays part of the owner's lifecycle tree.
 *
 * It is a hook, not a tag: a tag would add a host element in place, and the
 * point of a portal is to render NOTHING where it is declared. It drives the
 * same reconcile `bootstrap` does, so a component inside a portal gets `@created`,
 * `@mounted`, signals and teardown exactly as anywhere else — but it owns ONLY its
 * own nodes in the target, so two portals into one target coexist and neither
 * touches what was already there.
 *
 * `Head` is the first consumer of this, which is why the target under test is
 * usually `document.head`.
 */

// Portal-built tags carry no marker of their own, so tests mark theirs to sweep
// them: a failing test must not leave a <meta> in the shared jsdom head for the
// next one to trip over.
function cleanTestTags(): void {
  for (const el of [...document.head.querySelectorAll("[data-portal-test]")]) el.remove();
}

beforeEach(() => {
  resetDiagnostics();
  cleanTestTags();
});

describe("Portal renders into a target", () => {
  test("puts its child in the target, and nothing where it is declared", async () => {
    class Page extends Component {
      portal = this.use(Portal, () => ({
        children: <meta data-portal-test="1" name="p1" content="a" />,
        target: document.head,
      }));
      render() {
        return <div id="body">content</div>;
      }
    }

    const { container } = await getDOM(<Page />);

    // In the target …
    expect(document.head.querySelector('meta[name="p1"]')?.getAttribute("content")).toBe("a");
    // … and not in the owner's own DOM.
    expect(container.querySelector('meta[name="p1"]')).toBeNull();
    expect(container.textContent).toBe("content");
  });

  test("accepts an array of children, all placed in the target", async () => {
    class Page extends Component {
      portal = this.use(Portal, () => ({
        children: [
          <meta data-portal-test="1" name="m1" content="1" />,
          <meta data-portal-test="1" name="m2" content="2" />,
        ],
        target: document.head,
      }));
      render() {
        return <div>x</div>;
      }
    }

    await getDOM(<Page />);

    expect(document.head.querySelector('meta[name="m1"]')?.getAttribute("content")).toBe("1");
    expect(document.head.querySelector('meta[name="m2"]')?.getAttribute("content")).toBe("2");
  });

  test("follows a reactive child, reusing the same node", async () => {
    class Page extends Component {
      @state content = "a";
      portal = this.use(Portal, (self: Page) => ({
        children: <meta data-portal-test="1" name="p2" content={self.content} />,
        target: document.head,
      }));
      render() {
        return <div>{this.content}</div>;
      }
    }

    const { instance, settle } = await getDOM<Page>(<Page />);
    const node = document.head.querySelector('meta[name="p2"]');
    expect(node?.getAttribute("content")).toBe("a");

    instance.content = "b";
    await settle();

    expect(document.head.querySelector('meta[name="p2"]')?.getAttribute("content")).toBe("b");
    // Updated in place, not rebuilt.
    expect(document.head.querySelector('meta[name="p2"]')).toBe(node);
  });
});

describe("Portal owns only its own nodes", () => {
  test("two portals into one target coexist, and unmounting one leaves the other", async () => {
    class WithPortal extends Component<{ n: string }> {
      portal = this.use(Portal, (self: WithPortal) => ({
        children: <meta data-portal-test="1" name={self.props.n} content="x" />,
        target: document.head,
      }));
      render() {
        return <div>{this.props.n}</div>;
      }
    }

    class Page extends Component {
      @state showB = true;
      render() {
        return (
          <div>
            <WithPortal n="a" />
            {this.showB ? <WithPortal n="b" /> : null}
          </div>
        );
      }
    }

    const { instance, settle } = await getDOM<Page>(<Page />);
    expect(document.head.querySelector('meta[name="a"]')).not.toBeNull();
    expect(document.head.querySelector('meta[name="b"]')).not.toBeNull();

    instance.showB = false;
    await settle();

    // b's portal was torn down with its owner …
    expect(document.head.querySelector('meta[name="b"]')).toBeNull();
    // … and a's is untouched.
    expect(document.head.querySelector('meta[name="a"]')).not.toBeNull();
  });

  test("leaves pre-existing target content alone, through mount and unmount", async () => {
    const shell = document.createElement("meta");
    shell.setAttribute("name", "shell");
    shell.setAttribute("data-portal-test", "1");
    document.head.appendChild(shell);

    class Page extends Component {
      portal = this.use(Portal, () => ({
        children: <meta data-portal-test="1" name="p4" content="x" />,
        target: document.head,
      }));
      render() {
        return <div>x</div>;
      }
    }

    const { unmount } = await getDOM(<Page />);
    expect(document.head.querySelector('meta[name="shell"]')).toBe(shell);
    expect(document.head.querySelector('meta[name="p4"]')).not.toBeNull();

    unmount();

    // The portal cleaned up after itself and only itself.
    expect(document.head.querySelector('meta[name="shell"]')).toBe(shell);
    expect(document.head.querySelector('meta[name="p4"]')).toBeNull();
  });
});

describe("Portal edge cases the review found", () => {
  test("an empty portal does not adopt — and delete — another portal's nodes", async () => {
    /**
     * `adopt()` must fire only when the `shared` create never ran (hydration). A
     * portal whose children resolve to NOTHING still ran `place()` on a client
     * build, so guarding on "no nodes yet" mistook it for un-placed — and it then
     * seeded itself with every marked node in the target and swept them away.
     */
    class WithMeta extends Component {
      portal = this.use(Portal, () => ({
        children: <meta data-portal-test="1" name="keep" content="1" />,
        target: document.head,
      }));
      render() {
        return <div>a</div>;
      }
    }
    class Empty extends Component {
      portal = this.use(Portal, () => ({ children: null, target: document.head }));
      render() {
        return <div>b</div>;
      }
    }
    class Page extends Component {
      render() {
        return (
          <div>
            <WithMeta />
            <Empty />
          </div>
        );
      }
    }

    await getDOM(<Page />);

    expect(document.head.querySelector('meta[name="keep"]')).not.toBeNull();
  });

  test("accepts nested-array children without crashing", async () => {
    // The type is one level deep on purpose; this is the DEFENSIVE path for an
    // untyped caller, so the input is cast to stand in for one.
    const nested = [
      [<meta data-portal-test="1" name="n1" content="1" />],
      <meta data-portal-test="1" name="n2" content="2" />,
    ] as unknown as RamondaNode;

    class Page extends Component {
      portal = this.use(Portal, () => ({
        children: nested,
        target: document.head,
      }));
      render() {
        return <div>x</div>;
      }
    }

    await getDOM(<Page />);

    expect(document.head.querySelector('meta[name="n1"]')).not.toBeNull();
    expect(document.head.querySelector('meta[name="n2"]')).not.toBeNull();
  });
});

describe("Portal follows a reactive target", () => {
  test("moves its nodes to the new target when the target changes", async () => {
    const a = document.createElement("section");
    a.id = "home-a";
    document.body.appendChild(a);
    const b = document.createElement("section");
    b.id = "home-b";
    document.body.appendChild(b);

    class Page extends Component {
      @state useB = false;
      portal = this.use(Portal, (self: Page) => ({
        children: (
          <span data-portal-test="1" id="moved">
            x
          </span>
        ),
        target: self.useB ? b : a,
      }));
      render() {
        return <div>x</div>;
      }
    }

    const { instance, settle } = await getDOM<Page>(<Page />);
    expect(a.querySelector("#moved")).not.toBeNull();
    expect(b.querySelector("#moved")).toBeNull();

    instance.useB = true;
    await settle();

    // The SAME node moved — not a second copy in b and a stale one left in a.
    expect(a.querySelector("#moved")).toBeNull();
    expect(b.querySelector("#moved")).not.toBeNull();

    a.remove();
    b.remove();
  });

  /**
   * A component the children gain while the block is away is created on the page, when the target
   * returns — its `@mounted` sees an element in the document, which is what lets it measure or focus.
   */
  test("a component added while the block is away is mounted on the page", async () => {
    const mountedInDocument: boolean[] = [];
    class Chart extends Component {
      el = createRef<HTMLElement>();
      @mounted
      measure() {
        mountedInDocument.push(this.el.current?.isConnected === true);
      }
      render() {
        return <i ref={this.el}>chart</i>;
      }
    }
    class Page extends Component {
      @state open = true;
      @state withChart = false;
      portal = this.use(Portal, (self: Page) => ({
        children: self.withChart ? [<b key="d">dialog</b>, <Chart key="c" />] : [<b key="d">dialog</b>],
        target: (self.open ? document.body : undefined) as Element,
      }));
      render() {
        return <div>page</div>;
      }
    }
    const { instance, settle } = await getDOM<Page>(<Page />);
    try {
      instance.open = false;
      await settle();
      instance.withChart = true;
      await settle();
      expect(mountedInDocument).toEqual([]);
      instance.open = true;
      await settle();
      expect(mountedInDocument).toEqual([true]);
    } finally {
      instance.open = false;
      await settle();
    }
  });

  /**
   * A row inside a waiting block that its own signal changes is not rebuilt off the page either: a
   * component the row gains is created when the target returns, on the page.
   */
  test("a list row in a block that is away is rebuilt when it returns", async () => {
    const mountedInDocument: boolean[] = [];
    class Badge extends Component {
      el = createRef<HTMLElement>();
      @mounted
      measure() {
        mountedInDocument.push(this.el.current?.isConnected === true);
      }
      render() {
        return <i ref={this.el}>new</i>;
      }
    }
    class Page extends Component {
      @state open = true;
      @state fresh = false;
      items = [{ id: 1 }];
      row = (_item: { id: number }) => <li>{this.fresh ? <Badge /> : "old"}</li>;
      portal = this.use(Portal, (self: Page) => ({
        children: <ul>{list(self.items, self.row)}</ul>,
        target: (self.open ? document.body : undefined) as Element,
      }));
      render() {
        return <div>page</div>;
      }
    }
    const { instance, settle } = await getDOM<Page>(<Page />);
    try {
      instance.open = false;
      await settle();
      instance.fresh = true;
      await settle();
      expect(mountedInDocument).toEqual([]);
      instance.open = true;
      await settle();
      expect(mountedInDocument).toEqual([true]);
    } finally {
      instance.open = false;
      await settle();
    }
  });

  /**
   * A block that comes back takes the place it left, not the end of the target: two portals in one
   * container keep their order across a close and an open — a modal reopened under a toast stays
   * under it.
   */
  test("a block that comes back takes the place it left", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    class Page extends Component {
      @state open = true;
      first = this.use(Portal, (self: Page) => ({
        children: <b id="order-first">first</b>,
        target: (self.open ? host : undefined) as Element,
      }));
      second = this.use(Portal, () => ({ children: <b id="order-second">second</b>, target: host }));
      render() {
        return <div>page</div>;
      }
    }
    const { instance, settle } = await getDOM<Page>(<Page />);
    const order = () => Array.from(host.querySelectorAll("b"), (b) => b.id);
    try {
      expect(order()).toEqual(["order-first", "order-second"]);
      instance.open = false;
      await settle();
      expect(order()).toEqual(["order-second"]);
      instance.open = true;
      await settle();
      expect(order()).toEqual(["order-first", "order-second"]);
    } finally {
      host.remove();
    }
  });

  /**
   * Coming back into an element the owner renders leaves that element's own children in their order:
   * nothing of the portal's stays among them while it is away. Measured before: a mark left in the
   * host split its paragraphs around the block — 1, 3, the guest, 2.
   */
  test("a block that comes back into the owner's own element keeps that element's children in order", async () => {
    class Page extends Component {
      @state open = true;
      @state items = [1];
      section = createRef<HTMLElement>();
      portal = this.use(Portal, (self: Page) => ({
        children: <b id="inline-guest">guest</b>,
        target: (self.open ? self.section.current : undefined) as Element,
      }));
      render() {
        return (
          <section ref={this.section}>
            {this.items.map((i) => (
              <p key={i}>{i}</p>
            ))}
          </section>
        );
      }
    }
    const { instance, settle, container } = await getDOM<Page>(<Page />);
    const shown = () => Array.from(container.querySelector("section")!.children, (child) => child.textContent);
    // The section exists only after the first render, so the factory sees it on its next run.
    instance.open = false;
    await settle();
    instance.open = true;
    await settle();
    expect(shown()).toEqual(["1", "guest"]);

    instance.open = false;
    await settle();
    instance.items = [1, 2];
    await settle();
    instance.open = true;
    await settle();
    instance.items = [1, 2, 3];
    await settle();

    expect(shown()).toEqual(["1", "2", "3", "guest"]);
  });

  /**
   * Closing a portal closes the portals inside it. A modal's dropdown, portalled to a layer of its
   * own, leaves the page with the modal and comes back with it — the same component, not destroyed —
   * and one the modal gains while closed is built only when it opens.
   */
  describe("a portal inside a portal", () => {
    let layer: HTMLElement;
    let destroyedMenus = 0;
    class Menu extends Component<{ id: string }> {
      @state picked = "none";
      @destroyed
      gone() {
        destroyedMenus++;
      }
      render() {
        return <ul id={this.props.id}>{this.picked}</ul>;
      }
    }
    let dialog: Dialog | undefined;
    class Dialog extends Component {
      /** Its own state, so it renders off the page while the modal is closed. */
      @state second = false;
      menu = this.use(Portal, () => ({ children: <Menu id="nested-menu" />, target: layer }));
      @created
      known() {
        dialog = this;
      }
      render() {
        return <div id="nested-dialog">{this.second ? <Dropdown /> : null}</div>;
      }
    }
    class Dropdown extends Component {
      menu = this.use(Portal, () => ({ children: <Menu id="nested-second" />, target: layer }));
      render() {
        return <i>dropdown</i>;
      }
    }
    class Page extends Component {
      @state open = true;
      modal = this.use(Portal, (self: Page) => ({
        children: <Dialog />,
        target: (self.open ? document.body : undefined) as Element,
      }));
      render() {
        return <div>page</div>;
      }
    }
    beforeEach(() => {
      layer = document.createElement("aside");
      document.body.appendChild(layer);
      destroyedMenus = 0;
    });

    test("closing the outer one takes the inner one off the page, and opening brings it back", async () => {
      const { instance, settle } = await getDOM<Page>(<Page />);
      try {
        const menu = layer.querySelector("#nested-menu");
        expect(menu).not.toBeNull();
        instance.open = false;
        await settle();
        expect(layer.querySelector("#nested-menu")).toBeNull();
        instance.open = true;
        await settle();
        expect({ same: layer.querySelector("#nested-menu") === menu, destroyedMenus }).toEqual({
          same: true,
          destroyedMenus: 0,
        });
      } finally {
        instance.open = false;
        await settle();
        layer.remove();
      }
    });

    /**
     * A ROOT started from inside a modal is not inside it: it has no parent, and its portals belong to
     * nothing. Closing the modal leaves its toasts where they are.
     */
    test("a root started from inside a closed portal is not closed with it", async () => {
      class Toasts extends Component {
        toast = this.use(Portal, () => ({ children: <b id="nested-toast">saved</b>, target: layer }));
        render() {
          return <i>toasts</i>;
        }
      }
      const elsewhere = document.createElement("div");
      document.body.appendChild(elsewhere);
      class Starter extends Component {
        @created
        start() {
          bootstrap(<Toasts />, elsewhere);
        }
        render() {
          return <b>starter</b>;
        }
      }
      class Host extends Component {
        @state open = true;
        modal = this.use(Portal, (self: Host) => ({
          children: <Starter />,
          target: (self.open ? document.body : undefined) as Element,
        }));
        render() {
          return <div>host</div>;
        }
      }
      const { instance, settle } = await getDOM<Host>(<Host />);
      try {
        await settle();
        expect(layer.querySelector("#nested-toast")).not.toBeNull();
        instance.open = false;
        await settle();
        expect(layer.querySelector("#nested-toast")).not.toBeNull();
      } finally {
        elsewhere.remove();
        layer.remove();
      }
    });

    /**
     * Opening brings the inner portals back before the outer one's children are reconciled, so one
     * those children build then goes after them — the layer keeps the order of the tree.
     */
    test("an inner portal built as the outer one opens goes after the ones already there", async () => {
      class Tip extends Component {
        tip = this.use(Portal, () => ({ children: <b id="nested-tip">tip</b>, target: layer }));
        render() {
          return <i>tip</i>;
        }
      }
      class Modal extends Component<{ tip: boolean }> {
        menu = this.use(Portal, () => ({ children: <b id="nested-first">menu</b>, target: layer }));
        render() {
          return <div>{this.props.tip ? <Tip /> : null}</div>;
        }
      }
      class Host extends Component {
        @state open = true;
        @state tip = false;
        modal = this.use(Portal, (self: Host) => ({
          children: <Modal tip={self.tip} />,
          target: (self.open ? document.body : undefined) as Element,
        }));
        render() {
          return <div>host</div>;
        }
      }
      const { instance, settle } = await getDOM<Host>(<Host />);
      try {
        instance.open = false;
        await settle();
        instance.tip = true;
        await settle();
        instance.open = true;
        await settle();
        expect(Array.from(layer.querySelectorAll("b"), (b) => b.id)).toEqual(["nested-first", "nested-tip"]);
      } finally {
        instance.open = false;
        await settle();
        layer.remove();
      }
    });

    /**
     * An inner portal whose owner the reopening removes is not opened first: what it gained while
     * closed is never built, mounted and torn down for nothing.
     */
    test("an inner portal whose owner goes as the outer one opens builds nothing", async () => {
      let built = 0;
      class Row extends Component {
        @created
        counted() {
          built++;
        }
        render() {
          return <li>row</li>;
        }
      }
      let picker: Picker | undefined;
      class Picker extends Component {
        @state rows = false;
        menu = this.use(Portal, (self: Picker) => ({
          children: <ul>{self.rows ? <Row /> : null}</ul>,
          target: layer,
        }));
        @created
        known() {
          picker = this;
        }
        render() {
          return <i>picker</i>;
        }
      }
      class Host extends Component {
        @state open = true;
        @state confirm = false;
        modal = this.use(Portal, (self: Host) => ({
          children: self.confirm ? <b>confirm</b> : <Picker />,
          target: (self.open ? document.body : undefined) as Element,
        }));
        render() {
          return <div>host</div>;
        }
      }
      const { instance, settle } = await getDOM<Host>(<Host />);
      try {
        instance.open = false;
        await settle();
        picker!.rows = true;
        await settle();
        instance.confirm = true;
        await settle();
        instance.open = true;
        await settle();
        expect(built).toBe(0);
      } finally {
        instance.open = false;
        await settle();
        layer.remove();
      }
    });

    /**
     * A reopening whose reconcile throws — a child's `@destroyed` — still opens the portals inside:
     * the block is back on the page, and a dropdown left closed would be lost for good.
     */
    test("a reconcile that throws on opening still opens the inner portals", async () => {
      class Fragile extends Component {
        @destroyed
        boom() {
          throw new Error("teardown failed");
        }
        render() {
          return <i>fragile</i>;
        }
      }
      class Shell extends Component<{ fragile: boolean }> {
        menu = this.use(Portal, () => ({ children: <b id="nested-kept">menu</b>, target: layer }));
        render() {
          return <div>{this.props.fragile ? <Fragile /> : null}</div>;
        }
      }
      class Host extends Component {
        @state open = true;
        @state fragile = true;
        modal = this.use(Portal, (self: Host) => ({
          children: <Shell fragile={self.fragile} />,
          target: (self.open ? document.body : undefined) as Element,
        }));
        render() {
          return <div>host</div>;
        }
      }
      const { instance, settle } = await getDOM<Host>(<Host />);
      try {
        instance.open = false;
        await settle();
        instance.fragile = false;
        await settle();
        instance.open = true;
        await settle().catch(() => {});
        expect(layer.querySelector("#nested-kept")).not.toBeNull();
      } finally {
        layer.remove();
      }
    });

    test("an inner portal the closed one gains is built when it opens", async () => {
      const { instance, settle } = await getDOM<Page>(<Page />);
      try {
        instance.open = false;
        await settle();
        dialog!.second = true;
        await settle();
        expect(layer.querySelector("#nested-second")).toBeNull();
        instance.open = true;
        await settle();
        expect(layer.querySelector("#nested-second")).not.toBeNull();
      } finally {
        instance.open = false;
        await settle();
        layer.remove();
      }
    });
  });

  /** A list row changing in a closed portal does not render the portal's owner for nothing. */
  test("a row changing in a closed portal renders nothing", async () => {
    let renders = 0;
    // A signal the page does not own, so only the row reads it.
    const price = new State(1);
    class Page extends Component {
      @state open = true;
      items = [{ id: 1 }];
      row = (_item: { id: number }) => <li>{price.get()}</li>;
      portal = this.use(Portal, (self: Page) => ({
        children: <ul>{list(self.items, self.row)}</ul>,
        target: (self.open ? document.body : undefined) as Element,
      }));
      render() {
        renders++;
        return <div>page</div>;
      }
    }
    const { instance, settle } = await getDOM<Page>(<Page />);
    instance.open = false;
    await settle();
    renders = 0;
    for (let tick = 2; tick <= 4; tick++) {
      price.set(tick);
      await settle();
    }
    expect(renders).toBe(0);
  });

  /** A block in another document — an iframe — waits in a fragment of that document, not of this one. */
  test("a block closed in an iframe stays in the iframe's document", async () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const inside = frame.contentDocument!.body;
    class Page extends Component {
      @state open = true;
      portal = this.use(Portal, (self: Page) => ({
        children: <b id="framed">framed</b>,
        target: (self.open ? inside : undefined) as Element,
      }));
      render() {
        return <div>page</div>;
      }
    }
    const { instance, settle } = await getDOM<Page>(<Page />);
    try {
      const node = inside.querySelector("#framed")!;
      instance.open = false;
      await settle();
      expect(node.ownerDocument).toBe(frame.contentDocument);
    } finally {
      frame.remove();
    }
  });

  /** A block whose target is absent from the start is not built off the page: nothing is created yet. */
  test("a target absent at mount builds nothing until it arrives", async () => {
    let made = 0;
    class Toast extends Component<{ n: number }> {
      @created
      made() {
        made++;
      }
      render() {
        return <b>saved</b>;
      }
    }
    class Page extends Component {
      @state root: Element | null = null;
      @state tick = 0;
      portal = this.use(Portal, (self: Page) => ({ children: <Toast n={self.tick} />, target: self.root as Element }));
      render() {
        return <div>page</div>;
      }
    }
    const { instance, settle } = await getDOM<Page>(<Page />);
    instance.tick = 1;
    await settle();
    expect(made).toBe(0);
  });

  /**
   * A target that goes away takes the block off the page — `target: open ? document.body : undefined`
   * is how a modal closes — and brings the SAME nodes back when it returns: the component in it keeps
   * its state, is not destroyed while away, and hears what changed meanwhile once it is back.
   */
  test("a target that goes away takes the block off the page, and back", async () => {
    let destroyedCount = 0;
    class Dialog extends Component<{ title: string }> {
      @state typed = "";
      @destroyed
      gone() {
        destroyedCount++;
      }
      render() {
        return <b id="away-dialog">{this.props.title}</b>;
      }
    }
    class Page extends Component {
      @state open = true;
      @state title = "first";
      portal = this.use(Portal, (self: Page) => ({
        children: <Dialog title={self.title} />,
        target: (self.open ? document.body : undefined) as Element,
      }));
      render() {
        return <div id="away-page">page</div>;
      }
    }

    const { instance, settle } = await getDOM<Page>(<Page />);
    const shown = document.getElementById("away-dialog")!;
    expect(shown.parentNode).toBe(document.body);

    try {
      instance.open = false;
      await settle();
      expect(document.getElementById("away-dialog")).toBeNull();
      expect(destroyedCount).toBe(0);

      instance.title = "second";
      await settle();
      instance.open = true;
      await settle();

      const back = document.getElementById("away-dialog")!;
      expect({ same: back === shown, text: back.textContent, destroyedCount }).toEqual({
        same: true,
        text: "second",
        destroyedCount: 0,
      });
    } finally {
      instance.open = false;
      await settle();
    }
  });

  /**
   * Absent at mount, supplied later — which the class doc promises and nothing measured.
   *
   * It is not an error state. A portal declared beside a container that is not on screen yet is
   * ordinary: a toast layer revealed on first use, a modal root a route mounts. So it places nothing,
   * says nothing, and places the children the moment the target arrives.
   *
   * **The target has to be read from a SIGNAL for that to happen**, and this is the shape that makes
   * the promise true. `reconcile` runs again on `@watchProp(props.children)`, and `children` only gets
   * a new identity when the props factory re-runs — which it does when a signal it read has moved.
   * A factory that reads none is built once: `target: document.getElementById("x")!` with nothing
   * reactive around it places nothing and then never tries again. The class doc calls that "the
   * uncommon case, worth knowing"; the portal page now says it too.
   */
  test("a target absent at mount is placed the moment it arrives", async () => {
    class Toast extends Component {
      /** A signal, which is what makes the props factory run again. */
      @state root: Element | null = null;

      portal = this.use(Portal, (self: Toast) => ({
        children: <b id="late-toast">saved</b>,
        // biome-ignore lint/style/noNonNullAssertion: null at mount is the case under test
        target: self.root as Element,
      }));

      render() {
        return <div id="toast-app">app</div>;
      }
    }

    const { container, instance, settle } = await getDOM<Toast>(<Toast />);

    // Nothing placed, nothing thrown, and the owner rendered normally.
    expect(document.getElementById("late-toast")).toBeNull();
    expect(container.querySelector("#toast-app")!.textContent).toBe("app");

    const root = document.createElement("aside");
    root.id = "late-root";
    document.body.appendChild(root);

    try {
      instance.root = root;
      await settle();

      // Placed on the render that first had a target — not lost.
      expect(root.querySelector("#late-toast")).not.toBeNull();
      expect(root.querySelector("#late-toast")!.textContent).toBe("saved");
    } finally {
      root.remove();
    }
  });

  test("a component nested inside a moved block re-renders into the NEW target", async () => {
    /**
     * A region carries the DOM parent it sits in, and the move has to reach every one of them.
     *
     * `reconcileEntries` refreshes that field on the regions that are TOP-LEVEL entries of the
     * block's record. A component that renders a component produces one nested inside another with
     * no element between them — and the inner one is not visited unless its own props changed, which
     * a target change does not do. Left holding the OLD target, its next self-render reorders
     * against an element the nodes are no longer in.
     */
    const a = document.createElement("section");
    a.id = "nested-a";
    document.body.appendChild(a);
    const b = document.createElement("section");
    b.id = "nested-b";
    document.body.appendChild(b);

    class Leaf extends Component {
      @state two = false;
      render() {
        return this.two
          ? [
              <i data-portal-test="1" id="l1">
                1
              </i>,
              <u data-portal-test="1" id="l2">
                2
              </u>,
            ]
          : [
              <i data-portal-test="1" id="l1">
                1
              </i>,
            ];
      }
    }
    class Wrap extends Component {
      render() {
        return <Leaf />;
      }
    }
    class Page extends Component {
      @state useB = false;
      portal = this.use(Portal, (self: Page) => ({ children: <Wrap />, target: self.useB ? b : a }));
      render() {
        return <div>x</div>;
      }
    }

    const { instance, settle } = await getDOM<Page>(<Page />);
    expect(a.querySelector("#l1")).not.toBeNull();

    instance.useB = true;
    await settle();
    expect(b.querySelector("#l1")).not.toBeNull();
    expect(a.querySelector("#l1")).toBeNull();

    // Its own render, nobody else's: the second node has to land in b, beside the first.
    findAll<Leaf>(b, "Leaf")[0]!.two = true;
    await settle();

    expect(b.querySelector("#l2")).not.toBeNull();
    expect(a.querySelector("#l2")).toBeNull();
    expect([...b.childNodes].filter((n) => n.nodeType !== 8).map((n) => (n as Element).id)).toEqual(["l1", "l2"]);

    a.remove();
    b.remove();
  });

  test("inline is just a local target: point it at an element in your own render", async () => {
    // There is no "disabled"/inline flag: with an Element-based target, inline is
    // just a target that points at a local node instead of a far one.
    const far = document.createElement("section");
    far.id = "far";
    document.body.appendChild(far);

    class Page extends Component {
      @state inline = true;
      local = document.createElement("div");
      portal = this.use(Portal, (self: Page) => ({
        children: (
          <span data-portal-test="1" id="content">
            x
          </span>
        ),
        target: self.inline ? self.local : far,
      }));
      render() {
        return <div>x</div>;
      }
    }

    const { instance, settle } = await getDOM<Page>(<Page />);
    expect(instance.local.querySelector("#content")).not.toBeNull();
    expect(far.querySelector("#content")).toBeNull();

    instance.inline = false;
    await settle();

    expect(instance.local.querySelector("#content")).toBeNull();
    expect(far.querySelector("#content")).not.toBeNull();

    far.remove();
  });
});

describe("Portal reconciles keyed children by identity", () => {
  test("reordering keyed children moves the same nodes, not their contents", async () => {
    const target = document.createElement("ul");
    document.body.appendChild(target);

    class Page extends Component {
      @state order = ["a", "b", "c"];
      portal = this.use(Portal, (self: Page) => ({
        children: self.order.map((x) => (
          <li data-portal-test="1" key={x} id={`k-${x}`}>
            {x}
          </li>
        )),
        target,
      }));
      render() {
        return <div>x</div>;
      }
    }

    const { instance, settle } = await getDOM<Page>(<Page />);
    const rows = () => [...target.querySelectorAll("li")];
    expect(rows().map((li) => li.id)).toEqual(["k-a", "k-b", "k-c"]);
    const nodeA = rows()[0];

    instance.order = ["c", "a", "b"];
    await settle();

    // The DOM order follows the new order …
    expect(rows().map((li) => li.id)).toEqual(["k-c", "k-a", "k-b"]);
    // … and 'a' is the SAME node, moved — not a neighbour that took its content.
    expect(rows()[1]).toBe(nodeA);

    target.remove();
  });
});

describe("Portal is a full lifecycle boundary", () => {
  test("a component inside a portal runs @created, @mounted and @destroyed", async () => {
    const target = document.createElement("section");
    document.body.appendChild(target);

    let createdCount = 0;
    let mountedCount = 0;
    let destroyedCount = 0;

    class Inner extends Component {
      @created onCreate() {
        createdCount++;
      }
      @mounted onMount() {
        mountedCount++;
      }
      @destroyed onDestroy() {
        destroyedCount++;
      }
      render() {
        return <span id="inner">inner</span>;
      }
    }

    class Portaler extends Component {
      portal = this.use(Portal, () => ({
        children: <Inner />,
        target,
      }));
      render() {
        return <div>p</div>;
      }
    }

    class Page extends Component {
      @state show = true;
      render() {
        return <div>{this.show ? <Portaler /> : null}</div>;
      }
    }

    const { instance, settle } = await getDOM<Page>(<Page />);

    expect(createdCount).toBe(1);
    expect(mountedCount).toBe(1);
    expect(target.querySelector("#inner")?.textContent).toBe("inner");

    instance.show = false;
    await settle();

    expect(destroyedCount).toBe(1);
    expect(target.querySelector("#inner")).toBeNull();

    target.remove();
  });
});

describe("Portal follows its props", () => {
  /**
   * `children` and `target` are watched together, so one update that changes both moves and
   * re-renders the block in a single reconcile rather than two.
   */
  test("a change to children and target together reconciles once", async () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);

    class Page extends Component {
      @state there = false;
      portal = this.use(Portal, (self: Page) => ({
        children: <b>{self.there ? "second" : "first"}</b>,
        target: self.there ? second : first,
      }));
      render() {
        return <p>page</p>;
      }
    }

    // Counted where the portal's block is reconciled.
    const proto = ChildrenRegion.prototype as unknown as { reconcile(...args: unknown[]): void };
    const original = proto.reconcile;
    let reconciles = 0;
    proto.reconcile = function (this: unknown, ...args: unknown[]) {
      reconciles++;
      original.apply(this, args);
    };
    const app = await getDOM<Page>(<Page />);
    try {
      await app.settle();
      reconciles = 0;
      app.instance.there = true;
      await app.settle();
    } finally {
      proto.reconcile = original;
    }

    expect(reconciles).toBe(1);
    expect(second.textContent).toBe("second");
    expect(first.textContent).toBe("");
    app.unmount();
    first.remove();
    second.remove();
  });

  /**
   * A `list()` of the same array and callback, as a portal's children, does not reconcile the block
   * again on a factory run that changed nothing it shows: its descriptor is stamped by the block, and
   * the next one arrives unstamped.
   */
  test("a list() as children does not reconcile again on an unrelated factory run", async () => {
    const proto = ChildrenRegion.prototype as unknown as { reconcile(...args: unknown[]): void };
    const original = proto.reconcile;
    let reconciles = 0;
    proto.reconcile = function (this: unknown, ...args: unknown[]) {
      reconciles++;
      original.apply(this, args);
    };
    class Page extends Component {
      @state tick = 0;
      row(r: string) {
        return <i>{r}</i>;
      }
      portal = this.use(Portal, (self: Page) => ({
        children: list(ROWS, self.row),
        target: document.body,
        n: self.tick,
      }));
      render() {
        return <p>{this.tick}</p>;
      }
    }
    const app = await getDOM<Page>(<Page />);
    try {
      await app.settle();
      reconciles = 0;
      app.instance.tick = 1;
      await app.settle();
    } finally {
      proto.reconcile = original;
    }

    expect(reconciles).toBe(0);
    app.unmount();
  });

  /**
   * A container that was not on the page when the portal first reconciled — it was appended one of
   * its own — is where the block goes once the page has it.
   */
  test("a named target's container that arrives later is where the block goes", async () => {
    class Page extends Component {
      @state tick = 0;
      portal = this.use(Portal, (self: Page) => ({
        children: <b>here</b>,
        target: portalTarget("late"),
        n: self.tick,
      }));
      render() {
        return <p>{this.tick}</p>;
      }
    }
    const app = await getDOM<Page>(<Page />);
    await app.settle();
    const appended = document.querySelector(`[${PORTAL_TARGET_ATTR}="late"]`);
    expect(appended?.textContent).toBe("here");

    const real = document.createElement("div");
    real.setAttribute(PORTAL_TARGET_ATTR, "late");
    document.body.prepend(real);
    app.instance.tick = 1;
    await app.settle();

    expect(real.textContent).toBe("here");
    app.unmount();
    real.remove();
    appended?.remove();
  });

  /**
   * A container replaced under the same name — a layout that renders it, unmounted and mounted
   * again — is the one the block moves to on the next run of the props factory, which hands over a
   * new token and so looks the container up again.
   */
  test("a named target's container replaced under it is followed", async () => {
    const first = document.createElement("div");
    first.setAttribute(PORTAL_TARGET_ATTR, "swap");
    document.body.append(first);
    class Page extends Component {
      @state tick = 0;
      portal = this.use(Portal, (self: Page) => ({
        children: <b>moved</b>,
        target: portalTarget("swap"),
        n: self.tick,
      }));
      render() {
        return <p>{this.tick}</p>;
      }
    }
    const app = await getDOM<Page>(<Page />);
    await app.settle();
    expect(first.textContent).toBe("moved");

    first.remove();
    const second = document.createElement("div");
    second.setAttribute(PORTAL_TARGET_ATTR, "swap");
    document.body.append(second);
    app.instance.tick = 1;
    await app.settle();

    expect(second.textContent).toBe("moved");
    app.unmount();
    second.remove();
  });

  /**
   * `portalTarget("name")` written in the factory is a new token on every run. The container it names,
   * and children that say the same, are no change: the block is not reconciled again — counted, as a
   * reconcile is the whole block's work. A change to what the children say still is.
   */
  test("a factory run that names the same container with the same children reconciles nothing", async () => {
    const container = document.createElement("div");
    container.setAttribute(PORTAL_TARGET_ATTR, "same");
    document.body.append(container);
    class Page extends Component {
      @state count = 0;
      portal = this.use(Portal, (self: Page) => ({
        children: <b>{self.count > 0 ? "on" : "off"}</b>,
        target: portalTarget("same"),
      }));
      render() {
        return <p>{this.count}</p>;
      }
    }
    const app = await getDOM<Page>(<Page />);
    await app.settle();
    const original = ChildrenRegion.prototype.reconcile;
    let reconciles = 0;
    ChildrenRegion.prototype.reconcile = function (this: ChildrenRegion, ...args: Parameters<typeof original>) {
      reconciles++;
      return original.apply(this, args);
    };
    try {
      app.instance.count = 1;
      await app.settle();
      const afterTheChange = reconciles;
      for (const count of [2, 3, 4, 5, 6]) {
        app.instance.count = count;
        await app.settle();
      }
      expect({ afterTheChange, afterTheSame: reconciles - afterTheChange, shown: container.textContent }).toEqual({
        afterTheChange: 1,
        afterTheSame: 0,
        shown: "on",
      });
    } finally {
      ChildrenRegion.prototype.reconcile = original;
      app.unmount();
      container.remove();
    }
  });
});

const ROWS = ["r"];
