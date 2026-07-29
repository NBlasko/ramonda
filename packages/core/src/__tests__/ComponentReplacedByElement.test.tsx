import { describe, test, expect, beforeEach } from "vitest";
import { Component } from "../base/Component";
import { Host, state, destroy, interval } from "../base/decorators";
import { getDOM } from "../test/setup";
import { effectLike } from "../test/effectLike";

/**
 * A component swapped out for a plain element of the SAME TAG must be torn down.
 *
 * `areSimilarNodes` matched an intrinsic vnode against a node by `nodeName`
 * alone — and a component's host element has exactly the nodeName of its `@Host`
 * tag. So `{on ? <Panel /> : <div>empty</div>}`, with `@Host("div")` on Panel,
 * claimed Panel's own host for the plain `<div>`: the node was reused, the
 * component instance was dropped, and NOTHING tore it down.
 *
 * The failure is invisible from the page. The DOM looks right — the div is
 * there, with the right content — while the component behind it keeps its
 * subscriptions, intervals and window listeners for the life of the tab. Not
 * even RMD006 fires, because the leaked-timer check runs inside the teardown
 * that never happens.
 *
 * The reverse was always safe: a plain element has no `_componentDefinition`, so
 * it can never be claimed for a component vnode. Only this direction was open.
 */

const log: string[] = [];

@Host("div")
class Panel extends Component {
  @effectLike() subscribe() {
    log.push("effect");
    return () => log.push("cleanup");
  }
  @destroy bye() {
    log.push("destroy");
  }
  @interval(5) tick() {
    log.push("tick");
  }
  render() {
    return <b>panel</b>;
  }
}

@Host("section")
class Swapper extends Component<{ tag?: string }> {
  @state on = true;
  render() {
    if (this.on) return <Panel />;
    // Same tag as Panel's host — the case that used to reuse the node.
    return <div>empty</div>;
  }
}

beforeEach(() => {
  log.length = 0;
});

describe("a component replaced by a plain element of the same tag", () => {
  test("runs its effect cleanups and @destroy", async () => {
    const { instance, settle } = await getDOM<Swapper>(<Swapper />);
    expect(log).toEqual(["effect"]);

    instance.on = false;
    await settle();

    expect(log).toEqual(["effect", "cleanup", "destroy"]);
  });

  test("its timers really stop", async () => {
    const { instance, settle } = await getDOM<Swapper>(<Swapper />);
    instance.on = false;
    await settle();

    const ticksAtSwap = log.filter((l) => l === "tick").length;
    await new Promise((resolve) => setTimeout(resolve, 40));

    // An @interval that survived teardown would have fired several more times.
    expect(log.filter((l) => l === "tick").length).toBe(ticksAtSwap);
  });

  test("the DOM node is replaced, not reused", async () => {
    const { instance, settle, container } = await getDOM<Swapper>(<Swapper />);
    const before = container.querySelector("div");
    expect(before?.textContent).toBe("panel");

    instance.on = false;
    await settle();

    const after = container.querySelector("div");
    expect(after?.textContent).toBe("empty");
    // Reusing the node is exactly what orphaned the component.
    expect(after).not.toBe(before);
  });

  test("swapping back builds a fresh component", async () => {
    const { instance, settle } = await getDOM<Swapper>(<Swapper />);
    instance.on = false;
    await settle();
    instance.on = true;
    await settle();

    expect(log).toEqual(["effect", "cleanup", "destroy", "effect"]);
  });

  test("a plain element is still never claimed for a component", async () => {
    // The direction that was always correct — pinned so a fix to the other one
    // cannot quietly open this.
    @Host("div")
    class Reverse extends Component {
      @state on = false;
      render() {
        return this.on ? <Panel /> : <div>plain</div>;
      }
    }

    const { instance, settle, container } = await getDOM<Reverse>(<Reverse />);
    const plain = container.querySelectorAll("div")[1];

    instance.on = true;
    await settle();

    expect(log).toEqual(["effect"]);
    expect(container.textContent).toContain("panel");
    expect(container.querySelectorAll("div")[1]).not.toBe(plain);
  });
});
