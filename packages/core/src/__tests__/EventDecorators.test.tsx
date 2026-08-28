import { describe, test, expect, beforeEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { state, onWindow, onDocument } from "../base/decorators";

let log: string[] = [];

beforeEach(() => {
  log = [];
});

describe("@onWindow", () => {
  test("attaches on mount, calls handler with `this` + event, detaches on unmount", async () => {
    class Comp extends Component {
      @onWindow("scroll", { passive: true })
      onScroll(event: Event) {
        log.push(`scroll:${this instanceof Comp}:${event.type}`);
      }
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Comp>(<Comp />);

    window.dispatchEvent(new Event("scroll"));
    expect(log).toEqual(["scroll:true:scroll"]);

    // Unmount → listener removed.
    app.unmount();
    window.dispatchEvent(new Event("scroll"));
    expect(log).toEqual(["scroll:true:scroll"]);
  });
});

describe("@onDocument", () => {
  test("attaches on mount and detaches on unmount", async () => {
    class Comp extends Component {
      @onDocument("click")
      onClick(event: Event) {
        log.push(`doc:${event.type}`);
      }
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Comp>(<Comp />);

    document.dispatchEvent(new MouseEvent("click"));
    expect(log).toEqual(["doc:click"]);

    app.unmount();
    document.dispatchEvent(new MouseEvent("click"));
    expect(log).toEqual(["doc:click"]);
  });
});

describe("a listener in the markup", () => {
  test("a listener written in the markup reaches the element it is on", async () => {
    class Box extends Component {
      onClick(event: Event) {
        log.push(`el:${event.type}`);
      }
      render() {
        return (
          <div onclick={this.onClick}>
            <span>inner</span>
          </div>
        );
      }
    }

    const app = await getDOM<Box>(<Box />);

    const element = app.container.querySelector("span")!.parentElement!;
    expect(element.nodeName).toBe("DIV");

    element.dispatchEvent(new MouseEvent("click"));
    expect(log).toEqual(["el:click"]);

    /**
     * Unmounting takes the element out of the document, and that is the whole of what teardown owes
     * a markup listener.
     *
     * `@onElement` used to have a second obligation here — it attached through an effect, so its
     * cleanup called `removeEventListener`, and a test could prove it by dispatching on the
     * detached node. A listener written in the markup lives on the element itself: once the element
     * is out of the page nothing can reach it to click, and dispatching by hand on a node nobody
     * holds is not a case a page can be in.
     */
    app.unmount();
    expect(element.isConnected).toBe(false);
  });
});

describe("@Host", () => {
  test("swaps the host tag for a real element", async () => {
    class Panel extends Component {
      render() {
        return (
          <section>
            <span>content</span>
          </section>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);

    const host = app.container.querySelector("section");
    expect(host).not.toBeNull();
    expect(host?.textContent).toBe("content");
    // Real tag → no display:contents template style.
    expect(host?.getAttribute("style") ?? "").not.toContain("display: contents");
  });

  test("reactive props callback updates host attributes on state change", async () => {
    class Panel extends Component {
      @state open = false;
      render() {
        return (
          <section className={this.open ? "open" : "closed"}>
            <span>content</span>
          </section>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    const host = app.container.querySelector("section")!;

    expect(host.getAttribute("class")).toBe("closed");

    app.instance.open = true;
    await app.settle();

    expect(host.getAttribute("class")).toBe("open");
  });
});
