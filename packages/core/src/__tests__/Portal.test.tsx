import { describe, test, expect, beforeEach } from "vitest";
import { Component } from "../base/Component";
import { state, created, mounted, destroyed } from "../base/decorators";
import { Portal } from "../base/Portal";
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
