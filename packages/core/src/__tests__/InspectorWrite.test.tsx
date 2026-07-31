import { describe, expect, test } from "vitest";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { persist, state } from "../base/decorators";
import { scanComponentTree, writeInspectedState } from "../debug/inspector";
import { getDOM } from "../test/setup";

/**
 * Writing a field from devtools.
 *
 * The interesting cases are all refusals: props are read-only in every build (assigning throws), a
 * plain field is not state and writing it would change nothing anybody can see, and a handle from an
 * older scan must not land on whatever now occupies that slot. The happy path is one line.
 */

class Panel extends Component<{ label: string }> {
  @state count = 1;
  @state user = { name: "Ada", tags: ["x"] };
  @persist seen = false;
  plain = "not reactive";

  render() {
    return (
      <div id="panel">
        {this.props.label}:{String(this.count)}:{this.user.name}
      </div>
    );
  }
}

class Counter extends Hook {
  @state ticks = 0;
}

class WithHook extends Component {
  counter = this.use(Counter);
  render() {
    return <div id="with-hook">{String(this.counter.ticks)}</div>;
  }
}

const handleOf = (name: string): number => {
  const find = (nodes: ReturnType<typeof scanComponentTree>): number | undefined => {
    for (const node of nodes) {
      if (node.name === name) return node.id;
      const inHooks = find(node.hooks);
      if (inHooks !== undefined) return inHooks;
      const inChildren = find(node.children);
      if (inChildren !== undefined) return inChildren;
    }
    return undefined;
  };
  const id = find(scanComponentTree(document.body));
  if (id === undefined) throw new Error(`no node named ${name}`);
  return id;
};

describe("writing state from the panel", () => {
  test("goes through the ordinary setter, so the component rebuilds", async () => {
    using app = await getDOM<Panel>(<Panel label="n" />);
    const { container, settle } = app;
    expect(container.querySelector("#panel")!.textContent).toBe("n:1:Ada");

    expect(writeInspectedState(handleOf("Panel"), "count", 7)).toBe("ok");
    await settle();

    expect(container.querySelector("#panel")!.textContent).toBe("n:7:Ada");
  });

  /**
   * A signal holds a value, not a proxy — mutating inside an object notifies nobody — so an edit is
   * always a replacement of the whole field. The panel is held to the same rule as application code.
   */
  test("replaces a whole object rather than reaching into one", async () => {
    using app = await getDOM<Panel>(<Panel label="n" />);
    const { container, settle } = app;

    expect(writeInspectedState(handleOf("Panel"), "user", { name: "Grace", tags: ["y", "z"] })).toBe("ok");
    await settle();

    expect(container.querySelector("#panel")!.textContent).toBe("n:1:Grace");
  });

  test("writes a @persist field too", async () => {
    using app = await getDOM<Panel>(<Panel label="n" />);
    void app;

    expect(writeInspectedState(handleOf("Panel"), "seen", true)).toBe("ok");
  });

  test("writes a hook's state", async () => {
    using app = await getDOM<WithHook>(<WithHook />);
    const { container, settle } = app;

    expect(writeInspectedState(handleOf("Counter"), "ticks", 42)).toBe("ok");
    await settle();

    expect(container.querySelector("#with-hook")!.textContent).toBe("42");
  });

  /**
   * The refusal that matters most. Props are owned by whoever rendered you and assigning to one
   * throws in every build (RMD004 / RMD015) — so the panel must not be able to try.
   */
  test("refuses a prop", async () => {
    using app = await getDOM<Panel>(<Panel label="n" />);
    const { container } = app;

    expect(writeInspectedState(handleOf("Panel"), "label", "hacked")).toBe("not-state");
    expect(container.querySelector("#panel")!.textContent).toBe("n:1:Ada");
  });

  test("refuses a plain field, which no signal is watching", async () => {
    using app = await getDOM<Panel>(<Panel label="n" />);
    void app;

    expect(writeInspectedState(handleOf("Panel"), "plain", "x")).toBe("not-state");
  });

  test("refuses a handle from a scan that is over", async () => {
    using app = await getDOM<Panel>(<Panel label="n" />);
    void app;

    const id = handleOf("Panel");
    // A fresh scan replaces the handles, and this one is past the end of it.
    scanComponentTree(document.createElement("div"));

    expect(writeInspectedState(id, "count", 9)).toBe("gone");
    expect(writeInspectedState(9999, "count", 9)).toBe("gone");
  });

  test("says so when the value is already what it would write", async () => {
    using app = await getDOM<Panel>(<Panel label="n" />);
    void app;

    expect(writeInspectedState(handleOf("Panel"), "count", 1)).toBe("unchanged");
  });
});
