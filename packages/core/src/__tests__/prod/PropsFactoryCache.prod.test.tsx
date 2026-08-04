import { describe, test, expect } from "vitest";
import { Component, Hook, compute, state, bootstrap, unmount } from "../../index";
import { flushSync, getComponentInstance } from "../../testing";

/**
 * The props-callback cache in a production build.
 *
 * It is not a development affordance and must not become one: the caching is behaviour, and only
 * the RMD027 check around it is `__DEV__`. Grepping the minified bundle cannot answer this —
 * property names in the cache object are indistinguishable from `@compute`'s after minification —
 * so the question is settled by running the thing with `__DEV__` false.
 *
 * See `vitest.prod.config.ts` for why this is a separate process.
 */

describe("the props callback cache in production", () => {
  test("__DEV__ is false in this run", () => {
    expect(__DEV__).toBe(false);
  });

  test("one changed signal calls one callback, not all of them", () => {
    const HOOKS = 10;
    const RENDERS = 5;

    let callbackCalls = 0;
    let computeRuns = 0;

    class Probe extends Hook<{ filter: { q: string } }> {
      @compute get view(): string {
        computeRuns++;
        return this.props.filter.q;
      }
    }

    class Owner extends Component {
      @state query = "a";
      @state untouched = "fixed";

      probes: Probe[] = Array.from({ length: HOOKS }, (_, i) =>
        this.use(Probe, (self: Owner) => {
          callbackCalls++;
          return { filter: { q: i === 0 ? self.query : self.untouched } };
        }),
      );

      render() {
        return <div>{this.probes.map((p) => p.view).join(",")}</div>;
      }
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    bootstrap(<Owner />, container);
    flushSync();

    const instance = getComponentInstance(container.firstElementChild) as unknown as Owner;

    callbackCalls = 0;
    computeRuns = 0;

    for (let i = 0; i < RENDERS; i++) {
      instance.query = `q${i}`;
      flushSync();
    }

    // The same numbers the development run records. A build that differed here would mean apps
    // are tuned against work their users never do.
    expect(callbackCalls).toBe(RENDERS);
    expect(computeRuns).toBe(RENDERS);

    // And the value still arrives.
    expect(container.textContent?.startsWith("q4")).toBe(true);

    unmount(container);
    container.remove();
  });
});
