import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../../test/setup";
import { Component } from "../../base/Component";
import { Host, state, deferHydration, destroy, interval } from "../../base/decorators";
import { hydrateRoot } from "../../hydration/hydrate";

/**
 * A deferred subtree that resumes into a DIFFERENT host element than the server
 * wrote.
 *
 * The deferral adopts the server's node first and waits, so by the time the
 * promise settles there is a live component sitting on that node: initialized,
 * holding restored state, and holding whatever its client `@create` started. If
 * the client then renders a different tag, nothing can be adopted and hydration
 * falls back to building fresh — and `replaceChild` takes the NODE away while
 * leaving the component exactly where it was.
 *
 * Nothing tore it down. No `@destroy`, no effect cleanups, no signal detach: its
 * timers went on firing, its subscriptions stayed attached, and a later write to
 * a signal it had read would queue a render into a node no longer in the
 * document. All of it silent, because the page itself looks right — the fresh
 * element is there and the old one is gone.
 */
describe("a deferred subtree that resumes with a different host tag", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("tears the adopted component down before replacing its node", async () => {
    let destroyed = 0;
    let ticks = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    @Host((p: { as?: string }) => p.as ?? "div")
    class Deferred extends Component<{ as?: string }> {
      @state n = 0;

      // Client-only work the teardown is supposed to stop.
      @interval(5) tick() {
        ticks++;
      }

      @deferHydration wait() {
        return gate;
      }

      @destroy bye() {
        destroyed++;
      }

      render() {
        return <p>deferred {this.n}</p>;
      }
    }

    @Host("main")
    class Page extends Component<{ as?: string }> {
      render() {
        return (
          <div>
            <Deferred as={this.props.as} />
            <b id="after">after</b>
          </div>
        );
      }
    }

    // "server": the page rendered with a <div> host for the deferred part.
    const server = await getDOM(<Page as="div" />);
    await server.settle();
    const html = server.container.innerHTML;
    server.unmount();
    destroyed = 0;
    ticks = 0;

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    // The client wants a <span> instead — so the resume cannot adopt.
    hydrateRoot(<Page as="span" />, container);
    await Promise.resolve();

    // Adopted and waiting: the server's node is still the one on screen.
    expect(container.querySelector("div > div")).toBeTruthy();
    expect(destroyed).toBe(0);

    release();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The fresh element replaced the server's, in place — the sibling after it
    // is still after it.
    const span = container.querySelector("span");
    expect(span).toBeTruthy();
    expect(span!.nextElementSibling?.id).toBe("after");
    expect(container.querySelector("div > div")).toBeNull();

    // And the component that had been adopted onto the replaced node was torn
    // down rather than left running.
    expect(destroyed).toBe(1);

    const before = ticks;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ticks).toBe(before);

    container.remove();
  });
});
