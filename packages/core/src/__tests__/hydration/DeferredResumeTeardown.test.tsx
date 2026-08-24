import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM, servedMarkup } from "../../test/setup";
import { Component } from "../../base/Component";
import { state, deferHydration, destroyed, interval } from "../../base/decorators";
import { hydrateRoot } from "../../hydration/hydrate";

/**
 * A deferred subtree that resumes into a DIFFERENT host element than the server
 * wrote.
 *
 * The deferral adopts the server's node first and waits, so by the time the
 * promise settles there is a live component sitting on that node: initialized,
 * holding restored state, and holding whatever its client `@created` started. If
 * the client then renders a different tag, nothing can be adopted and hydration
 * falls back to building fresh — and `replaceChild` takes the NODE away while
 * leaving the component exactly where it was.
 *
 * Nothing tore it down. No `@destroyed`, no effect cleanups, no signal detach: its
 * timers went on firing, its subscriptions stayed attached, and a later write to
 * a signal it had read would queue a render into a node no longer in the
 * document. All of it silent, because the page itself looks right — the fresh
 * element is there and the old one is gone.
 */
describe("a deferred subtree that resumes with a different element", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("replaces the element and keeps the component that was restored", async () => {
    let destroyedCount = 0;
    let ticks = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    class Deferred extends Component<{ as?: string }> {
      @state n = 0;

      // Client-only work, which a live component keeps.
      @interval(5) tick() {
        ticks++;
      }

      @deferHydration wait() {
        return gate;
      }

      @destroyed bye() {
        destroyedCount++;
      }

      render() {
        /**
         * The element the caller asked for, chosen in the render.
         *
         * The point of this test is a RESUME that cannot adopt what the server wrote, so the two
         * sides have to be able to disagree about the tag — which used to be a `@Host` callback and
         * is now an ordinary conditional. Same disagreement, written where the markup is.
         */
        return this.props.as === "span" ? <span>deferred {this.n}</span> : <div>deferred {this.n}</div>;
      }
    }

    class Page extends Component<{ as?: string }> {
      render() {
        return (
          <main>
            <div>
              <Deferred as={this.props.as} />
              <b id="after">after</b>
            </div>
          </main>
        );
      }
    }

    // "server": the page rendered with a <div> host for the deferred part.
    const server = await getDOM(<Page as="div" />);
    await server.settle();
    const html = servedMarkup(server.container, { state: false });
    server.unmount();
    destroyedCount = 0;
    ticks = 0;

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    // The client wants a <span> instead — so the resume cannot adopt.
    hydrateRoot(<Page as="span" />, container);
    await Promise.resolve();

    // Adopted and waiting: the server's node is still the one on screen.
    expect(container.querySelector("div > div")).toBeTruthy();
    expect(destroyedCount).toBe(0);

    release();
    await new Promise((resolve) => setTimeout(resolve, 20));

    /**
     * The `<span>` replaced the server's `<div>`, in place — the sibling after it is still after it.
     *
     * And the component was NOT torn down, which is the part that changed with the host. It used to
     * be adopted ONTO the server's element, so a resume that wanted a different tag had nothing to
     * adopt: the node was replaced and the instance had to go with it, or it lived on with no DOM.
     *
     * A component owns a RANGE now. Its markers say where its block is whatever is inside, so a
     * resume that renders a different element patches the block — the same thing an ordinary
     * re-render does — and the instance never stops being the one that was restored. Its state, its
     * hooks and its timers carry straight through, which is what a resume was always trying to do.
     */
    const span = container.querySelector("span");
    expect(span).toBeTruthy();
    expect(span!.nextElementSibling?.id).toBe("after");
    expect(container.querySelector("div > div")).toBeNull();
    expect(destroyedCount).toBe(0);

    /**
     * And its `@interval` is still running, which is the other half of the same change.
     *
     * The old shape had to stop it: the component was adopted onto the server's element, a resume
     * that wanted a different tag replaced that element, and an instance with no DOM whose timer
     * still fires is the leak `RMD006` exists for. Nothing is replaced out from under this component
     * — it owns a range, and the range is where its new element went — so it is a live component on
     * a live page and its timer belongs to it.
     */
    const before = ticks;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ticks).toBeGreaterThan(before);

    container.remove();
  });
});
