import { describe, test, expect, beforeEach } from "vitest";
import { Component } from "../base/Component";
import { state, create, mount, destroy } from "../base/decorators";
import { Portal } from "../base/Portal";
import { getDOM } from "../test/setup";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * `Portal` — renders a subtree into a DOM target elsewhere (its whole reason to
 * exist), while the subtree stays part of the owner's lifecycle tree.
 *
 * It is a hook, not a tag: a tag would add a host element in place, and the
 * point of a portal is to render NOTHING where it is declared. It drives the
 * same reconcile `bootstrap` does, so a component inside a portal gets `@create`,
 * `@mount`, signals and teardown exactly as anywhere else — but it owns ONLY its
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
      portal = this.use(Portal, {
        children: <meta data-portal-test="1" name="p1" content="a" />,
        target: document.head,
      });
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
      portal = this.use(Portal, {
        children: [
          <meta data-portal-test="1" name="m1" content="1" />,
          <meta data-portal-test="1" name="m2" content="2" />,
        ],
        target: document.head,
      });
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
      portal = this.use(Portal, {
        children: <meta data-portal-test="1" name="p4" content="x" />,
        target: document.head,
      });
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

describe("Portal is a full lifecycle boundary", () => {
  test("a component inside a portal runs @create, @mount and @destroy", async () => {
    const target = document.createElement("section");
    document.body.appendChild(target);

    let created = 0;
    let mounted = 0;
    let destroyed = 0;

    class Inner extends Component {
      @create onCreate() {
        created++;
      }
      @mount onMount() {
        mounted++;
      }
      @destroy onDestroy() {
        destroyed++;
      }
      render() {
        return <span id="inner">inner</span>;
      }
    }

    class Portaler extends Component {
      portal = this.use(Portal, {
        children: <Inner />,
        target,
      });
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

    expect(created).toBe(1);
    expect(mounted).toBe(1);
    expect(target.querySelector("#inner")?.textContent).toBe("inner");

    instance.show = false;
    await settle();

    expect(destroyed).toBe(1);
    expect(target.querySelector("#inner")).toBeNull();

    target.remove();
  });
});
