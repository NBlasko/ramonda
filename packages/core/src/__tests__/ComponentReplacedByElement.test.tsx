import { describe, test, expect, beforeEach } from "vitest";
import { Component } from "../base/Component";
import { state, destroyed, interval } from "../base/decorators";
import { getDOM } from "../test/setup";
import { effectLike } from "../test/effectLike";

/**
 * A component swapped out for a plain element of the same tag must be torn down.
 *
 * The failure this guards against is invisible from the page: the DOM looks right — the div is
 * there, with the right content — while the component behind it keeps its subscriptions, intervals
 * and window listeners for the life of the tab. Not even RMD006 fires, because the leaked-timer
 * check runs inside the teardown that never happens.
 *
 * It used to be a real hazard in the node matcher. A component WAS an element, and its host had
 * exactly the nodeName of its `@Host` tag, so `areSimilarNodes` handed Panel's own host to the plain
 * `<div>` and dropped the instance on the floor. That confusion is gone with the host: a component
 * is a region in the record and a plain element is a node in the pool, and the two cannot be
 * mistaken for one another. What replaces the old guard is the region going away — the vnode is no
 * longer a component, so nothing claims the region, and `disposeRegions` runs its teardown.
 *
 * Which is exactly what this still has to prove, by the mechanism rather than by the tag.
 */

const log: string[] = [];

class Panel extends Component {
  @effectLike() subscribe() {
    log.push("effect");
    return () => log.push("cleanup");
  }
  @destroyed bye() {
    log.push("destroy");
  }
  @interval(5) tick() {
    log.push("tick");
  }
  render() {
    return (
      <div>
        <b>panel</b>
      </div>
    );
  }
}

class Swapper extends Component<{ tag?: string }> {
  @state on = true;
  render() {
    if (this.on)
      return (
        <section>
          <Panel />
        </section>
      );
    // Same tag as Panel's host — the case that used to reuse the node.
    return (
      <section>
        <div>empty</div>
      </section>
    );
  }
}

beforeEach(() => {
  log.length = 0;
});

describe("a component replaced by a plain element of the same tag", () => {
  test("runs its effect cleanups and @destroyed", async () => {
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
    class Reverse extends Component {
      @state on = false;
      render() {
        return <div>{this.on ? <Panel /> : <div>plain</div>}</div>;
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
