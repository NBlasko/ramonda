import { describe, test, expect, beforeEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { state, Host, onElement } from "../base/decorators";

let log: string[] = [];

beforeEach(() => {
  log = [];
});

describe("Host props diffing", () => {
  test("host attributes are updated and removed across re-renders", async () => {
    @Host("div", (self: Panel) => (self.mode === "a" ? { id: "x", "data-role": "primary" } : { id: "y" }))
    class Panel extends Component {
      @state mode = "a";
      render() {
        return <span>c</span>;
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    const host = app.container.querySelector("span")!.parentElement!;

    expect(host.getAttribute("id")).toBe("x");
    expect(host.getAttribute("data-role")).toBe("primary");

    // Switch mode: id changes, data-role is dropped.
    app.instance.mode = "b";
    await app.settle();

    expect(host.getAttribute("id")).toBe("y");
    expect(host.getAttribute("data-role")).toBeNull();
  });

  test("className is removed when the callback stops returning it", async () => {
    @Host("div", (self: Panel) => (self.on ? { className: "active" } : {}))
    class Panel extends Component {
      @state on = true;
      render() {
        return <span>c</span>;
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    const host = app.container.querySelector("span")!.parentElement!;

    expect(host.getAttribute("class")).toBe("active");

    app.instance.on = false;
    await app.settle();

    // The `class` attribute must actually be gone, not left stale.
    expect(host.getAttribute("class")).toBeNull();
  });
});

describe("Host props diffing — edge cases", () => {
  test("multiple attributes added, changed and removed in one transition", async () => {
    @Host("div", (self: P) => (self.step === 1 ? { id: "a", title: "t1", "data-x": "1" } : { id: "b", "data-y": "2" }))
    class P extends Component {
      @state step = 1;
      render() {
        return <span>c</span>;
      }
    }

    const app = await getDOM<P>(<P />);
    const host = app.container.querySelector("span")!.parentElement!;

    expect(host.getAttribute("id")).toBe("a");
    expect(host.getAttribute("title")).toBe("t1");
    expect(host.getAttribute("data-x")).toBe("1");
    expect(host.getAttribute("data-y")).toBeNull();

    app.instance.step = 2;
    await app.settle();

    expect(host.getAttribute("id")).toBe("b"); // changed
    expect(host.getAttribute("title")).toBeNull(); // removed
    expect(host.getAttribute("data-x")).toBeNull(); // removed
    expect(host.getAttribute("data-y")).toBe("2"); // added
  });

  test("boolean/falsy attribute toggles on and off", async () => {
    @Host("button", (self: B) => ({ disabled: self.locked }))
    class B extends Component {
      @state locked = true;
      render() {
        return <span>c</span>;
      }
    }

    const app = await getDOM<B>(<B />);
    const host = app.container.querySelector("span")!.parentElement!;

    expect(host.hasAttribute("disabled")).toBe(true);

    app.instance.locked = false;
    await app.settle();
    expect(host.hasAttribute("disabled")).toBe(false);

    app.instance.locked = true;
    await app.settle();
    expect(host.hasAttribute("disabled")).toBe(true);
  });

  test("object style on the host updates", async () => {
    @Host("div", (self: S) => ({ style: { color: self.c } }))
    class S extends Component {
      @state c = "red";
      render() {
        return <span>c</span>;
      }
    }

    const app = await getDOM<S>(<S />);
    const host = app.container.querySelector("span")!.parentElement as HTMLElement;

    expect(host.style.color).toBe("red");

    app.instance.c = "blue";
    await app.settle();
    expect(host.style.color).toBe("blue");
  });

  test("static @Host (no props) renders and updates its children", async () => {
    @Host("div")
    class Counter extends Component {
      @state n = 0;
      render() {
        return <span>{this.n}</span>;
      }
    }

    const app = await getDOM<Counter>(<Counter />);
    const host = app.container.querySelector("span")!.parentElement!;
    expect(host.nodeName).toBe("DIV");
    expect(host.textContent).toBe("0");

    app.instance.n = 1;
    await app.settle();
    expect(host.textContent).toBe("1");
  });

  test("host attributes and children update together in one render", async () => {
    @Host("div", (self: C) => ({ "data-n": String(self.n) }))
    class C extends Component {
      @state n = 0;
      render() {
        return <span>{this.n}</span>;
      }
    }

    const app = await getDOM<C>(<C />);
    const host = app.container.querySelector("span")!.parentElement!;

    expect(host.getAttribute("data-n")).toBe("0");
    expect(host.textContent).toBe("0");

    app.instance.n = 5;
    await app.settle();

    expect(host.getAttribute("data-n")).toBe("5");
    expect(host.textContent).toBe("5");
  });
});

describe("Host attributes: no redundant writes, no `name` pollution", () => {
  test("unchanged primitive host attributes are not re-applied on re-render", async () => {
    @Host("div", () => ({ tabindex: 0, "data-fixed": "y" }))
    class C extends Component {
      @state n = 0;
      render() {
        return <span>{this.n}</span>;
      }
    }

    const app = await getDOM<C>(<C />);
    const host = app.container.querySelector("span")!.parentElement!;

    const spy = vi.spyOn(host, "setAttribute");
    spy.mockClear(); // ignore mount-time writes

    app.instance.n = 1;
    await app.settle();

    // Values are unchanged (0 vs stored "0", "y" vs "y") → must NOT be re-set.
    const rewritten = spy.mock.calls.map((c) => c[0]);
    expect(rewritten).not.toContain("tabindex");
    expect(rewritten).not.toContain("data-fixed");

    spy.mockRestore();
  });

  test("host has no `name` attribute; host props may set `name` freely", async () => {
    @Host("div", () => ({ name: "email" }))
    class Form extends Component {
      render() {
        return <span>x</span>;
      }
    }

    const app = await getDOM<Form>(<Form />);
    const host = app.container.querySelector("span")!.parentElement!;

    // The framework no longer injects `name`, so a user's `name` is untouched.
    expect(host.getAttribute("name")).toBe("email");
  });

  test("component marker is the namespaced data-ramonda, not `name`", async () => {
    @Host("div")
    class Widget extends Component {
      render() {
        return <span>x</span>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    const host = app.container.querySelector("span")!.parentElement!;

    expect(host.hasAttribute("name")).toBe(false);
    // Dev-only debug marker (tests run in dev).
    expect(host.getAttribute("data-ramonda")).toBe("Widget");
  });
});

describe("Host props + @onElement interaction", () => {
  test("decorator listener survives host re-renders that change props", async () => {
    @Host("div", (self: Box) => ({ className: self.active ? "on" : "off" }))
    class Box extends Component {
      @state active = false;
      @onElement("click")
      onClick() {
        log.push(`click:${this.active}`);
      }
      render() {
        return <span>x</span>;
      }
    }

    const app = await getDOM<Box>(<Box />);
    const host = app.container.querySelector("span")!.parentElement!;

    expect(host.getAttribute("class")).toBe("off");
    host.dispatchEvent(new MouseEvent("click"));
    expect(log).toEqual(["click:false"]);

    // Re-render that rewrites the host's attributes.
    app.instance.active = true;
    await app.settle();
    expect(host.getAttribute("class")).toBe("on");

    // Listener still attached (it lives outside the vdom attribute set) and
    // sees the updated state.
    host.dispatchEvent(new MouseEvent("click"));
    expect(log).toEqual(["click:false", "click:true"]);
  });

  test("@onElement attaches exactly once (not per render)", async () => {
    @Host("div", (self: Box) => ({ "data-n": String(self.n) }))
    class Box extends Component {
      @state n = 0;
      @onElement("click")
      onClick() {
        log.push("click");
      }
      render() {
        return <span>x</span>;
      }
    }

    const app = await getDOM<Box>(<Box />);
    const host = app.container.querySelector("span")!.parentElement!;

    // Force several re-renders (each rewrites host attributes).
    app.instance.n = 1;
    await app.settle();
    app.instance.n = 2;
    await app.settle();
    app.instance.n = 3;
    await app.settle();
    expect(host.getAttribute("data-n")).toBe("3");

    // A single click must fire the handler exactly once — no duplicate binds.
    host.dispatchEvent(new MouseEvent("click"));
    expect(log).toEqual(["click"]);
  });
});
