import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, state, compute } from "../index";
import { effectLike } from "../test/effectLike";

/**
 * An effect that reads a `@compute` on a cache HIT.
 *
 * A `@compute` that is already fresh touches no signal at all when it is read —
 * it hands back `cache.value`. So the deps have to be forwarded to whoever is
 * reading, or that reader records nothing and never hears about a change. The
 * compute getter does exactly that; the question this file settles is WHO it
 * forwards to.
 *
 * There are two independent tracking scopes: `trackerContainer.current` (another
 * `@compute`, a list item, a hook's props cache) and
 * `reactivityScope.currentEffect` (an effect). Only the first was fed, and the
 * ordering that exposes it is the ordinary one: `render()` reads the compute and
 * fills its cache, effects run afterwards in the post-commit flush, so an effect
 * reading the same compute always reads it on a HIT.
 *
 * The control test is the proof of cause: the same effect over the raw signal has
 * always re-run, so the compute indirection is the difference and not the harness.
 */
describe("an effect that reads a cached @compute", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("re-runs when the compute's source changes", async () => {
    let effectRuns = 0;
    let lastSeen = 0;

    class Comp extends Component {
      @state n = 1;

      @compute
      get doubled() {
        return this.n * 2;
      }

      // Runs in the post-commit flush, AFTER render() has already read `doubled`
      // and filled its cache — so this read is a HIT and the body never touches
      // the raw `n` signal itself.
      @effectLike()
      watchDoubled() {
        lastSeen = this.doubled;
        effectRuns++;
      }

      render() {
        return <span>{this.doubled}</span>;
      }
    }

    const app = await getDOM<Comp>(<Comp />);
    await app.settle();
    expect(effectRuns).toBe(1);
    expect(lastSeen).toBe(2);

    app.instance.n = 5;
    await app.settle();

    expect(effectRuns).toBe(2);
    expect(lastSeen).toBe(10);
  });

  test("control — reading the source signal directly re-runs the effect", async () => {
    let effectRuns = 0;

    class Comp extends Component {
      @state n = 1;

      @effectLike()
      watchN() {
        void this.n;
        effectRuns++;
      }

      render() {
        return <span>{this.n}</span>;
      }
    }

    const app = await getDOM<Comp>(<Comp />);
    await app.settle();
    expect(effectRuns).toBe(1);

    app.instance.n = 5;
    await app.settle();
    expect(effectRuns).toBe(2);
  });

  test("a signal the compute does not read leaves the effect alone", async () => {
    let effectRuns = 0;

    class Comp extends Component {
      @state n = 1;
      @state unrelated = "x";

      @compute
      get doubled() {
        return this.n * 2;
      }

      @effectLike()
      watchDoubled() {
        void this.doubled;
        effectRuns++;
      }

      render() {
        return <span data-unrelated={this.unrelated}>{this.doubled}</span>;
      }
    }

    const app = await getDOM<Comp>(<Comp />);
    await app.settle();
    expect(effectRuns).toBe(1);

    // Forwarding the compute's deps must not turn into "re-run on any commit":
    // this re-renders the component without touching what `doubled` reads.
    app.instance.unrelated = "y";
    await app.settle();

    expect(effectRuns).toBe(1);
    expect(app.container.querySelector("span")!.getAttribute("data-unrelated")).toBe("y");
  });

  test("the effect follows the compute's deps as they change", async () => {
    let effectRuns = 0;
    let lastSeen = "";

    class Comp extends Component {
      @state useFirst = true;
      @state first = "a";
      @state second = "b";

      // Reads ONE of the two signals, so which one it depends on moves.
      @compute
      get chosen() {
        return this.useFirst ? this.first : this.second;
      }

      @effectLike()
      watchChosen() {
        lastSeen = this.chosen;
        effectRuns++;
      }

      render() {
        return <span>{this.chosen}</span>;
      }
    }

    const app = await getDOM<Comp>(<Comp />);
    await app.settle();
    expect(effectRuns).toBe(1);

    // Not a dep right now — the effect must not wake up for it.
    app.instance.second = "B";
    await app.settle();
    expect(effectRuns).toBe(1);

    app.instance.useFirst = false;
    await app.settle();
    expect(effectRuns).toBe(2);
    expect(lastSeen).toBe("B");

    // Now `second` IS the dep, and the branch it used to read is not.
    app.instance.second = "BB";
    await app.settle();
    expect(effectRuns).toBe(3);
    expect(lastSeen).toBe("BB");

    app.instance.first = "A";
    await app.settle();
    expect(effectRuns).toBe(3);
  });
});
