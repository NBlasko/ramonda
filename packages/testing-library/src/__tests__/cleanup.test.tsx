import { describe, test, expect, beforeEach } from "vitest";
import { Component, state, destroy, interval, onWindow, type RamondaNode } from "@ramonda/core";
import { render, cleanup, act } from "../index";

/**
 * Automatic cleanup is the part of a harness nobody notices until it is missing,
 * and its absence does not look like a leak — it looks like an unrelated test
 * failing.
 *
 * Two failures were measured while building this, on the ad-hoc harness this
 * package replaces:
 *
 * 1. A leaked container keeps a LIVE tree. Its `@interval`s keep firing and its
 *    window listeners stay attached, into whatever runs next.
 * 2. Ids stop being unique across containers, and jsdom resolves even a SCOPED
 *    `container.querySelector("#x")` through a document-wide index — so a query
 *    returns a node from an earlier test. Those tests pass one at a time and
 *    fail together, which points the blame at the wrong file.
 */

let ticks = 0;
let windowEvents = 0;

class Noisy extends Component {
  @state n = 0;

  @interval(1) tick() {
    ticks++;
  }

  @onWindow("resize") onResize() {
    windowEvents++;
  }

  render(): RamondaNode {
    return <p id="shared-id">noisy {this.n}</p>;
  }
}

beforeEach(() => {
  ticks = 0;
  windowEvents = 0;
});

describe("cleanup", () => {
  test("removes the container from the document", () => {
    const { container } = render(<Noisy />);
    expect(container.isConnected).toBe(true);

    cleanup();

    expect(container.isConnected).toBe(false);
  });

  test("really unmounts — timers stop and listeners detach", async () => {
    render(<Noisy />);

    cleanup();

    const before = ticks;
    window.dispatchEvent(new Event("resize"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Removing the node alone would leave both of these climbing.
    expect(windowEvents).toBe(0);
    expect(ticks).toBe(before);
  });

  test("runs @destroy for every tree, not just the last one", () => {
    const log: string[] = [];

    class Tracked extends Component<{ name: string }> {
      @destroy bye() {
        log.push(this.props.name);
      }
      render(): RamondaNode {
        return <p>{this.props.name}</p>;
      }
    }

    render(<Tracked name="first" />);
    render(<Tracked name="second" />);

    cleanup();

    expect(log.sort()).toEqual(["first", "second"]);
  });

  test("is idempotent: unmount then cleanup does not tear down twice", () => {
    let destroys = 0;

    class Once extends Component {
      @destroy bye() {
        destroys++;
      }
      render(): RamondaNode {
        return <p>once</p>;
      }
    }

    const { unmount } = render(<Once />);
    unmount();
    cleanup();

    expect(destroys).toBe(1);
  });

  test("the automatic hook leaves the document empty between tests", () => {
    // This test asserts nothing about itself — it exists so the NEXT one can
    // check that what it rendered is gone.
    render(<Noisy />);
    act(() => {});
    expect(document.querySelectorAll("#shared-id").length).toBe(1);
  });

  test("…and here it is gone, without this test asking for it", () => {
    // No cleanup() call anywhere above. If auto-registration were broken, the
    // previous test's #shared-id would still be here and the count would be 1
    // before this test rendered anything.
    expect(document.querySelectorAll("#shared-id").length).toBe(0);

    render(<Noisy />);
    // Still exactly one, so the duplicate-id lookup that broke scoped queries
    // cannot happen.
    expect(document.querySelectorAll("#shared-id").length).toBe(1);
  });
});
