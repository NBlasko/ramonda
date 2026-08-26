import { describe, test, expect, beforeEach } from "vitest";
import { Component } from "../base/Component";
import { state } from "../base/decorators";
import { Portal } from "../base/Portal";
import { getDOM, findAll } from "../test/setup";
import { scanComponentTree } from "../debug/inspector";
import { setInspectRoot } from "../debug/devtoolsBridge";
import { componentsIn } from "../core/DiffAndMerge";
import { renderPage } from "../hydration/ssr";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * A component inside a `ChildrenRegion` — a `Portal`, or the `Head` hook.
 *
 * The region owns its own record, which is the whole point of the class: a portal writes into a
 * target it SHARES with the shell and with every other portal, so it cannot own that element's
 * record. Everything that reads the record therefore has to be told where a block's own record is,
 * and three readers were not: the position search an empty component does, the devtools tree, and
 * the server's marker pass.
 *
 * The block publishes itself on its opening anchor — a comment that is already a permanent node in
 * the target — so an ordinary walk over the target's children finds it.
 */

let target: HTMLElement;

beforeEach(() => {
  resetDiagnostics();
  target = document.createElement("aside");
  target.id = "target";
  document.body.appendChild(target);
});

describe("a component in a portal", () => {
  test("an empty one filling in lands inside its own anchors", async () => {
    class Late extends Component {
      @state shown = false;
      render() {
        return this.shown ? <b id="late">late</b> : null;
      }
    }

    class Page extends Component {
      portal = this.use(Portal, () => ({ children: <Late />, target }));
      render() {
        return <div id="body">body</div>;
      }
    }

    const { settle, unmount } = await getDOM(<Page />);
    target.insertAdjacentHTML("afterbegin", '<u id="before">before</u>');

    const late = componentsIn(target).find((c) => c.constructor.name === "Late") as unknown as {
      shown: boolean;
    };
    expect(late).toBeDefined();

    late.shown = true;
    await settle();

    /**
     * INSIDE the pair, not after it.
     *
     * A component that owns no node has nothing to place its first node relative to, and this one is
     * not in the target's record — the block's record holds it. Read as "not found", the search
     * answered `null`, which means the end of the parent: the node escaped its own anchors, landed
     * past every other block in the target, and `dispose()` did not take it away with the rest.
     */
    const nodes = [...target.childNodes];
    const open = nodes.findIndex((n) => n.nodeType === 8 && /^r\d+$/.test((n as Comment).data));
    const close = nodes.findIndex((n) => n.nodeType === 8 && /^\/r\d+$/.test((n as Comment).data));
    const at = nodes.findIndex((n) => (n as Element).id === "late");

    expect(open).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(open);
    expect(at).toBeGreaterThan(open);
    expect(at).toBeLessThan(close);

    // And because it is inside the block, the block takes it away.
    unmount();
    expect(target.querySelector("#late")).toBeNull();
  });

  test("the devtools tree and the record readers both find it", async () => {
    class Shown extends Component {
      @state n = 1;
      render() {
        return <i id="shown">{this.n}</i>;
      }
    }

    class Page extends Component {
      portal = this.use(Portal, () => ({ children: <Shown />, target }));
      render() {
        return <div id="body">body</div>;
      }
    }

    const { container } = await getDOM(<Page />);
    setInspectRoot(document.body);

    // The test harness's own lookup, which reads the record.
    expect(findAll<object>(target, "Shown")).toHaveLength(1);

    // And the panel, from the root. A portalled component is in the tree wherever its nodes are.
    const names: string[] = [];
    const collect = (nodes: ReturnType<typeof scanComponentTree>): void => {
      for (const node of nodes) {
        names.push(node.name);
        collect(node.children);
      }
    };
    collect(scanComponentTree(document.body));

    expect(names).toContain("Page");
    expect(names).toContain("Shown");
    void container;
  });

  test("the server marks it exactly once, from whichever pass reaches it first", async () => {
    class Badge extends Component {
      @state count = 0;
      render() {
        return <meta data-portal-test="1" name="badge" content={String(this.count)} />;
      }
    }

    class Page extends Component {
      badge = this.use(Portal, () => ({ children: <Badge />, target: document.head }));
      render() {
        return <p id="p">page</p>;
      }
    }

    try {
      const page = await renderPage(<Page />);

      /**
       * One pair in the served head, not two.
       *
       * The pass runs twice over a head block by design — `renderPage` marks the body, `collectHead`
       * marks the head, and a block in the head is reachable from both. A second visit inserts a
       * second pair, which reads to a hydrating client as a component inside a component: it adopts
       * the outer pair's nodes, hits the inner opening marker as a child, and builds a component
       * from a marker the server never meant as one.
       */
      const opens = page.head.match(/<!--c\d+/g) ?? [];
      const closes = page.head.match(/<!--\/c\d+-->/g) ?? [];

      expect(page.head).toContain('name="badge"');
      expect(opens).toHaveLength(1);
      expect(closes).toHaveLength(1);
    } finally {
      for (const el of [...document.head.querySelectorAll("[data-portal-test]")]) el.remove();
      for (const node of [...document.head.childNodes]) {
        if (node.nodeType === 8) node.remove();
      }
      document.title = "";
    }
  });
});
