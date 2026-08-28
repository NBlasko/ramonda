import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component } from "../../base/Component";
import { state, deferHydration } from "../../base/decorators";
import { renderPage } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";
import { instanceOf } from "../../test/setup";

/**
 * A page stays interactive while one subtree waits for its markup to be hydratable — that is the
 * whole point of `@deferHydration`. So the ordinary case is that the REST of the page re-renders
 * while the promise is still in flight, and a render that adds a child in front of the waiting block
 * has to put it in front of the block's opening marker.
 *
 * The markers are the block's boundary and they are nodes the region holds, so they belong in its
 * record like any other. Left out of it, the parent's record said the block began at the first node
 * INSIDE it: the new sibling was inserted there, which is between the marker and the server's
 * content, and `resumeHydration` — whose walk starts at `open.nextSibling` — then hydrated the
 * deferred component's first child against a node belonging to somebody else.
 */

let released: (() => void) | undefined;

class Slow extends Component {
  @state ready = false;

  @deferHydration wait() {
    return new Promise<void>((resolve) => {
      released = resolve;
    }).then(() => {
      this.ready = true;
    });
  }

  render() {
    return (
      <div id="slow">
        <p id="inside">{this.ready ? "ready" : "waiting"}</p>
      </div>
    );
  }
}

class Page extends Component {
  @state top = false;
  render() {
    return (
      <div id="shell">
        {this.top ? <p id="top">top</p> : null}
        <Slow />
      </div>
    );
  }
}

let container: HTMLElement | undefined;

beforeEach(() => {
  released = undefined;
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
});

describe("a sibling rendered while a subtree waits", () => {
  test("lands in front of the deferred block, not inside it", async () => {
    const page = await renderPage(<Page />);
    container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    hydrateRoot(<Page />, container);
    await Promise.resolve();

    const shell = () => container!.querySelector("#shell")!;
    const instance = instanceOf<Page>(shell());

    // The rest of the page is live while the block waits.
    instance.top = true;
    await Promise.resolve();
    await Promise.resolve();

    // In front of the block's opening marker, not between it and the server's content.
    expect(shell().innerHTML).toBe(
      '<p id="top">top</p><!--c1--><div id="slow"><p id="inside">waiting</p></div><!--/c1-->',
    );

    // Now let it resume: it hydrates its OWN content, and the sibling is untouched.
    released?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();

    expect(container!.querySelector("#inside")!.textContent).toBe("ready");
    expect([...shell().children].map((child) => child.id)).toEqual(["top", "slow"]);
    expect(container!.querySelectorAll("#top")).toHaveLength(1);
    // Every marker consumed once the block has resumed.
    expect(shell().innerHTML).not.toContain("<!--");
  });
});
