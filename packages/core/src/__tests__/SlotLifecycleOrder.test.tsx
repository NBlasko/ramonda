import { describe, test, expect } from "vitest";
import { getDOM, findAll } from "../test/setup";
import { state, created, mounted, updated, destroyed } from "../base/decorators";
import { Component } from "../base/Component";
import { COMPONENT_RUNTIME } from "../core/runtime";
import type { RamondaNode } from "../types/vdom";

/**
 * The order the four lifecycle methods run in, across a tree built out of slots.
 *
 * One rule, stated here because nothing else states it in one place and every hook's own test only
 * sees its own half:
 *
 *   **`@created` runs top-down. `@mounted`, `@updated` and `@destroyed` run bottom-up.**
 *
 * The reason is the same for all four. `@created` is part of building: a parent is constructed, and
 * it is its render that produces the children, so the parent necessarily exists first. The other
 * three want the finished DOM — a child's nodes are in place before its parent's run is complete,
 * so a parent that reads its subtree in `@mounted` finds it there, and a child that releases
 * something in `@destroyed` does it while its parent is still standing.
 *
 * And "down" means WHERE A COMPONENT LANDS. A slot written in one component and placed in another
 * belongs to the second: its lifecycle parent is where it renders, its depth is that parent's plus
 * one, and it therefore runs with the bottom of the tree even when the JSX for it sits at the top.
 * The same rule a context lookup follows, and the one thing about slots worth knowing before
 * writing one.
 */

const log: string[] = [];

class Node_ extends Component<{ tag: string; tick?: number; children?: RamondaNode }> {
  @created c() {
    log.push(`created:${this.props.tag}`);
  }
  @mounted m() {
    log.push(`mounted:${this.props.tag}`);
  }
  @updated u() {
    log.push(`updated:${this.props.tag}`);
  }
  @destroyed d() {
    log.push(`destroyed:${this.props.tag}`);
  }
  render() {
    return <div id={this.props.tag}>{this.props.children}</div>;
  }
}

/**
 * `outer` holds `middle` holds `inner` holds `payload` — and every one of them is written in
 * `App`'s render, handed down as a slot. Nothing here nests in the source the way it nests on the
 * page; the nesting is what the slots make.
 */
class App extends Component {
  @state tick = 0;
  @state deep = true;
  render() {
    return (
      <Node_ tag="outer" tick={this.tick}>
        <Node_ tag="middle" tick={this.tick}>
          {this.deep ? (
            <Node_ tag="inner" tick={this.tick}>
              <Node_ tag="payload" tick={this.tick} />
            </Node_>
          ) : null}
        </Node_>
      </Node_>
    );
  }
}

describe("the order four lifecycles run in, through slots", () => {
  test("created goes down, mounted comes back up", async () => {
    log.length = 0;
    const app = await getDOM<App>(<App />);
    await app.settle();

    expect(log).toEqual([
      "created:outer",
      "created:middle",
      "created:inner",
      "created:payload",
      "mounted:payload",
      "mounted:inner",
      "mounted:middle",
      "mounted:outer",
    ]);
  });

  test("a slot's lifecycle parent is where it LANDS, not where it was written", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();

    const byTag = Object.fromEntries(findAll<Node_>(app.container, "Node_").map((n) => [n.props.tag, n]));
    const parentTag = (tag: string) => {
      const parent = byTag[tag]![COMPONENT_RUNTIME].parent as Node_ | undefined;
      return parent ? (parent.props?.tag ?? parent.constructor.name) : "-";
    };
    const depth = (tag: string) => byTag[tag]![COMPONENT_RUNTIME].depth;

    // Every one of these was written in App's render, side by side in one expression.
    expect(parentTag("outer")).toBe("App");
    expect(parentTag("middle")).toBe("outer");
    expect(parentTag("inner")).toBe("middle");
    expect(parentTag("payload")).toBe("inner");

    // And the depths follow the placement, one apart all the way down.
    expect(depth("middle")).toBe(depth("outer") + 1);
    expect(depth("inner")).toBe(depth("middle") + 1);
    expect(depth("payload")).toBe(depth("inner") + 1);
  });

  test("updated comes back up too, and only for what actually changed", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();

    log.length = 0;
    app.instance.tick = 1;
    await app.settle();

    // `tick` reaches all four as a prop, so all four update — deepest first.
    expect(log).toEqual(["updated:payload", "updated:inner", "updated:middle", "updated:outer"]);
  });

  test("destroyed comes back up, and only the branch that went", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();

    log.length = 0;
    app.instance.deep = false;
    await app.settle();

    // The two that left, child before parent — and nothing from the two that stayed, which are
    // still on the page and did not re-render into a different shape.
    expect(log.filter((entry) => entry.startsWith("destroyed"))).toEqual(["destroyed:payload", "destroyed:inner"]);
    expect(log.filter((entry) => entry.startsWith("created"))).toEqual([]);
    expect(app.container.querySelector("#inner")).toBeNull();
    expect(app.container.querySelector("#outer")).not.toBeNull();
  });

  test("a component destroyed in the same commit does not also get an @updated", async () => {
    /**
     * `deep` false changes `middle`'s children AND removes two components. `@updated` is queued
     * before the teardown decides who is leaving, so this is the case where the two passes have to
     * agree: a component on its way out must not be told its props changed.
     */
    const app = await getDOM<App>(<App />);
    await app.settle();

    log.length = 0;
    app.instance.deep = false;
    app.instance.tick = 1;
    await app.settle();

    expect(log).not.toContain("updated:inner");
    expect(log).not.toContain("updated:payload");
    // The ones that stayed still got theirs.
    expect(log).toContain("updated:middle");
    expect(log).toContain("updated:outer");
  });

  test("unmounting the root tears the whole tree down, deepest first", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();

    log.length = 0;
    app.unmount();

    expect(log).toEqual(["destroyed:payload", "destroyed:inner", "destroyed:middle", "destroyed:outer"]);
  });
});

describe("two slot trees side by side", () => {
  class Pair extends Component {
    @state left = true;
    render() {
      return (
        <div id="pair">
          {this.left ? (
            <Node_ tag="L">
              <Node_ tag="L1" />
            </Node_>
          ) : null}
          <Node_ tag="R">
            <Node_ tag="R1" />
          </Node_>
        </div>
      );
    }
  }

  test("one going away does not disturb the other's lifecycle", async () => {
    log.length = 0;
    const app = await getDOM<Pair>(<Pair />);
    await app.settle();

    // Each tree's own order, and the LEFT one entirely before the right — siblings are built in
    // order, and each is finished before the next begins.
    expect(log).toEqual([
      "created:L",
      "created:L1",
      "created:R",
      "created:R1",
      "mounted:L1",
      "mounted:L",
      "mounted:R1",
      "mounted:R",
    ]);

    log.length = 0;
    app.instance.left = false;
    await app.settle();

    /**
     * The left tree leaves, child first. `R` also gets an `@updated`, and that is not the left tree
     * disturbing it: `Pair` re-rendered, so `R`'s `children` prop is a NEW vnode object, and a
     * changed prop is a changed prop whether or not it renders the same. That is the standing cost
     * of children being props — `@StableProps` is what declines it.
     *
     * `R1` gets none: it is inside `R`'s output, and its own props (`tag`) really are unchanged.
     */
    expect(log).toEqual(["destroyed:L1", "destroyed:L", "updated:R"]);
    expect(app.container.querySelector("#R1")).not.toBeNull();
  });
});
