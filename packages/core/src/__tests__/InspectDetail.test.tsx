import { describe, expect, test } from "vitest";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { state } from "../base/decorators";
import { INSPECT } from "../base/inspect";
import { scanComponentTree } from "../debug/inspector";
import { getDOM } from "../test/setup";

/**
 * An instance saying what it actually HOLDS.
 *
 * The inspector reads `@state`, `@persist`, props and context reads — all four about how a value was
 * DECLARED. A hook that keeps its state in plain fields behind a `@state` counter therefore shows the
 * counter and nothing else, which was the whole picture for `@ramonda/form`: `{ version: 7 }`, and
 * props that never change.
 *
 * That shape is what the framework recommends rather than an oversight, so the answer is to let the
 * instance describe itself.
 */

/** A hook shaped the way `Form` and `Mutation` are: a counter, and the real state beside it. */
class Counter extends Hook {
  @state private version = 0;
  private items: string[] = [];

  add(item: string): void {
    this.items.push(item);
    this.version++;
  }

  [INSPECT](): Record<string, unknown> {
    return { items: [...this.items], count: this.items.length };
  }
}

function findByName(nodes: ReturnType<typeof scanComponentTree>, name: string): (typeof nodes)[number] | undefined {
  for (const node of nodes) {
    if (node.name === name) return node;
    const inner = findByName([...node.hooks, ...node.children], name);
    if (inner) return inner;
  }
  return undefined;
}

describe("[INSPECT]", () => {
  test("a hook's own answer reaches the tree, beside the counter that is all `state` has", async () => {
    class Page extends Component {
      counter = this.use(Counter);
      render() {
        return <div>{String(this.counter)}</div>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    app.instance.counter.add("a");
    app.instance.counter.add("b");
    await app.settle();

    const hook = findByName(scanComponentTree(app.container), "Counter");

    // What the inspector could see before: a number going up.
    expect(hook?.state).toEqual({ version: 2 });
    // What the instance says it holds.
    expect(hook?.detail).toEqual({ items: ["a", "b"], count: 2 });
  });

  test("a component can describe itself too", async () => {
    class Page extends Component {
      private secretlyHeld = { rows: 3 };
      render() {
        return <div />;
      }
      [INSPECT](): Record<string, unknown> {
        return { held: this.secretlyHeld };
      }
    }

    const app = await getDOM<Page>(<Page />);
    const node = findByName(scanComponentTree(app.container), "Page");

    expect(node?.detail).toEqual({ held: { rows: 3 } });
  });

  test("an instance without one contributes nothing, and the field is absent", async () => {
    class Plain extends Component {
      @state count = 1;
      render() {
        return <div />;
      }
    }

    const app = await getDOM<Plain>(<Plain />);
    const node = findByName(scanComponentTree(app.container), "Plain");

    expect(node?.state).toEqual({ count: 1 });
    expect(node?.detail).toBeUndefined();
  });

  test("a throwing [INSPECT] costs its own row and nothing else", async () => {
    // This calls code the framework did not write, during a walk whose job is to diagnose an app
    // that may already be broken. Letting it escape would take down the scan — and the panel —
    // exactly when someone is trying to find out why.
    class Broken extends Component {
      render() {
        return <div />;
      }
      [INSPECT](): Record<string, unknown> {
        throw new Error("mid-construction");
      }
    }

    class Fine extends Component {
      @state ok = true;
      render() {
        return <div />;
      }
      [INSPECT](): Record<string, unknown> {
        return { fine: true };
      }
    }

    class Page extends Component {
      render() {
        return (
          <div>
            <Broken />
            <Fine />
          </div>
        );
      }
    }

    const app = await getDOM<Page>(<Page />);
    const tree = scanComponentTree(app.container);

    expect(findByName(tree, "Broken")?.detail).toEqual({ "[INSPECT] threw": "Error: mid-construction" });
    // The walk carried on, and the sibling is intact.
    expect(findByName(tree, "Fine")?.detail).toEqual({ fine: true });
  });

  test("a non-object answer is ignored rather than shown as one", async () => {
    class Odd extends Component {
      render() {
        return <div />;
      }
      [INSPECT](): Record<string, unknown> {
        return "not an object" as unknown as Record<string, unknown>;
      }
    }

    const app = await getDOM<Odd>(<Odd />);

    expect(findByName(scanComponentTree(app.container), "Odd")?.detail).toBeUndefined();
  });

  test("the symbol is the registry one, so two copies of core agree", () => {
    // `Symbol.for`, not `Symbol()` — an app with a duplicate core must not have two different
    // symbols, or a hook built against one copy would be invisible to the other's inspector.
    expect(INSPECT).toBe(Symbol.for("ramonda.inspect"));
  });
});
