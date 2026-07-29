import { describe, expect, test } from "vitest";
import { Component } from "../../base/Component";
import { createContext } from "../../base/Context";
import { scanComponentTree } from "../../debug/inspector";
import type { InspectedNode } from "../../debug/inspector";
import { getDOM } from "../../test/setup";
import { state } from "../../base/decorators";

/**
 * What devtools can show for a context consumer, and what it must not do to find out.
 *
 * A consumer holds no state and no props — every value it exposes is an accessor over the
 * provider's signals — so it used to appear in the panel as an empty node: the emptiest thing in
 * the tree being the hook whose entire job is reading. The catch is that the panel cannot read
 * those accessors, because READING IS SUBSCRIBING. So the consumer answers for itself.
 */

const [ThemeProvider, ThemeConsumer] = createContext({ color: "red", width: 10 }, { label: "Theme" });

function findHook(nodes: InspectedNode[], name: string): InspectedNode | undefined {
  for (const node of nodes) {
    for (const hook of node.hooks) {
      if (hook.name === name) return hook;
      const nested = findHook([{ ...hook, children: [], hooks: hook.hooks }], name);
      if (nested) return nested;
    }
    const inChildren = findHook(node.children, name);
    if (inChildren) return inChildren;
  }
  return undefined;
}

describe("inspecting a context consumer", () => {
  test("reports the key it reads with its value, and names the one it does not", async () => {
    class Leaf extends Component {
      theme = this.use(ThemeConsumer);
      render() {
        // `color` only. `width` is never read, which is the whole point of per-key signals.
        return <span>{this.theme.color}</span>;
      }
    }

    class App extends Component {
      theme = this.use(ThemeProvider, () => ({ color: "blue", width: 42 }));
      render() {
        void this.theme;
        return (
          <div>
            <Leaf />
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    void app;

    const consumer = findHook(scanComponentTree(document.body), "ThemeConsumer");
    expect(consumer).toBeDefined();
    expect(consumer!.reads).toBeDefined();

    expect(consumer!.reads!.color).toBe("blue");
    // Not `undefined`, which would claim the provider supplies nothing — and not the value,
    // because fetching it would subscribe this consumer to `width`.
    expect(String(consumer!.reads!.width)).toContain("not read");
  });

  /**
   * The guarantee that matters. If inspecting subscribed the consumer to every key, a component
   * would re-render on values it never reads — for as long as the panel had been opened once.
   */
  test("inspecting does not widen what the consumer wakes on", async () => {
    let builds = 0;

    class Leaf extends Component {
      theme = this.use(ThemeConsumer);
      render() {
        builds++;
        return <span>{this.theme.color}</span>;
      }
    }

    class App extends Component {
      @state size = 1;
      theme = this.use(ThemeProvider, () => ({ color: "blue", width: this.size }));
      render() {
        void this.theme;
        return (
          <div>
            <Leaf />
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    const { instance, settle } = app;

    const before = builds;
    // The panel doing its job, twice, over every key.
    for (let i = 0; i < 2; i++) findHook(scanComponentTree(document.body), "ThemeConsumer");
    expect(builds).toBe(before);

    instance.size = 99;
    await settle();

    // `width` moved and this consumer never read it, so it must not have rebuilt.
    expect(builds).toBe(before);
  });

  test("a provider is not asked, since its provided value is already its props", async () => {
    class App extends Component {
      theme = this.use(ThemeProvider, () => ({ color: "green", width: 3 }));
      render() {
        return <div>{this.theme.color}</div>;
      }
    }

    using app = await getDOM<App>(<App />);
    void app;

    const provider = findHook(scanComponentTree(document.body), "ThemeProvider");
    expect(provider!.options).toEqual({ color: "green", width: 3 });
    expect(provider!.reads).toBeUndefined();
  });
});
