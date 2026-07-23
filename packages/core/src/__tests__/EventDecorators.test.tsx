import { describe, test, expect, beforeEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { state, onWindow, onDocument, onElement, Host } from "../base/decorators";

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

describe("@onElement", () => {
  test("binds to the component host element (real tag via @Host)", async () => {
    @Host("div")
    class Box extends Component {
      @onElement("click")
      onClick(event: Event) {
        log.push(`el:${event.type}`);
      }
      render() {
        return <span>inner</span>;
      }
    }

    const app = await getDOM<Box>(<Box />);

    // The host is the <div> wrapping the rendered <span>.
    const host = app.container.querySelector("span")!.parentElement!;
    expect(host.nodeName).toBe("DIV");

    host.dispatchEvent(new MouseEvent("click"));
    expect(log).toEqual(["el:click"]);

    app.unmount();
    host.dispatchEvent(new MouseEvent("click"));
    expect(log).toEqual(["el:click"]);
  });
});

describe("@Host", () => {
  test("swaps the host tag for a real element", async () => {
    @Host("section")
    class Panel extends Component {
      render() {
        return <span>content</span>;
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
    @Host("section", (self: Panel) => ({
      className: self.open ? "open" : "closed",
    }))
    class Panel extends Component {
      @state open = false;
      render() {
        return <span>content</span>;
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
