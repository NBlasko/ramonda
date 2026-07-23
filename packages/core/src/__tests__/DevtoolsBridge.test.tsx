import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state } from "../index";
import { initDevtoolsBridge, setInspectRoot, inspectTree, notifyComponentUpdate } from "../debug/devtoolsBridge";

/**
 * The bridge's whole claim is that a closed devtools panel costs the app
 * nothing: no tree walks, no events, no work. These pin that claim, because it
 * is the kind of thing that quietly stops being true.
 */
const frame = () => new Promise((r) => setTimeout(r, 32));

@Host("div")
class Counter extends Component {
  @state n = 0;
  render() {
    return <span>{this.n}</span>;
  }
}

describe("devtools bridge", () => {
  let ticks = 0;
  const onTick = () => ticks++;
  beforeEach(() => {
    ticks = 0;
    window.addEventListener("ramonda:tick", onTick);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    window.removeEventListener("ramonda:tick", onTick);
    window.dispatchEvent(new CustomEvent("ramonda:devtools-unwatch"));
    vi.restoreAllMocks();
  });

  test("exposes the inspect hook once, however often it is installed", () => {
    initDevtoolsBridge();
    const w = window as any;
    expect(typeof w.__RAMONDA_INSPECT__).toBe("function");

    const first = w.__RAMONDA_INSPECT__;
    initDevtoolsBridge();
    expect(w.__RAMONDA_INSPECT__).toBe(first);
  });

  test("stays silent while nobody is watching", async () => {
    initDevtoolsBridge();
    const app = await getDOM<Counter>(<Counter />);
    await app.settle();
    ticks = 0;
    app.instance.n = 1;
    await app.settle();
    await frame();
    expect(ticks).toBe(0);
  });

  test("ticks once the devtools starts watching", async () => {
    initDevtoolsBridge();
    const app = await getDOM<Counter>(<Counter />);
    await app.settle();
    window.dispatchEvent(new CustomEvent("ramonda:devtools-watch"));
    ticks = 0;
    app.instance.n = 1;
    await app.settle();
    await frame();
    expect(ticks).toBe(1);
  });

  test("ten updates in a frame become one tick", async () => {
    initDevtoolsBridge();
    const app = await getDOM<Counter>(<Counter />);
    await app.settle();
    window.dispatchEvent(new CustomEvent("ramonda:devtools-watch"));
    ticks = 0;
    for (let i = 0; i < 10; i++) {
      app.instance.n = i;
      await app.settle();
    }
    await frame();
    expect(ticks).toBe(1);
  });

  test("unwatching stops it again", async () => {
    initDevtoolsBridge();
    const app = await getDOM<Counter>(<Counter />);
    await app.settle();
    window.dispatchEvent(new CustomEvent("ramonda:devtools-watch"));
    window.dispatchEvent(new CustomEvent("ramonda:devtools-unwatch"));
    ticks = 0;
    app.instance.n = 5;
    await app.settle();
    await frame();
    expect(ticks).toBe(0);
  });

  test("a tick scheduled before the panel closed does not fire", async () => {
    initDevtoolsBridge();
    window.dispatchEvent(new CustomEvent("ramonda:devtools-watch"));
    ticks = 0;
    // Scheduled while watching, panel closed before the frame ran. It used to
    // fire anyway, and the devtools would walk a tree nobody was looking at.
    notifyComponentUpdate();
    window.dispatchEvent(new CustomEvent("ramonda:devtools-unwatch"));
    await frame();

    expect(ticks).toBe(0);
  });

  test("inspectTree reads the tree from the root bootstrap set", async () => {
    const app = await getDOM<Counter>(<Counter />);
    await app.settle();
    setInspectRoot(app.container);
    const tree = inspectTree();
    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0]?.name).toBe("Counter");
  });
});
