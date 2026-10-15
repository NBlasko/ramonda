import { beforeEach, describe, expect, test } from "vitest";
import { Component, created } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { render, act } from "@ramonda/testing-library";
import { Router, RouteOutlet, Navigator } from "../Router";
import { createRoutes } from "../match";

/**
 * A component re-renders for the part of the URL it reads, and for nothing else.
 *
 * Measured otherwise: every `push` parsed the whole URL into new `{}` objects, so a component reading
 * only the hash re-rendered on a path change that left the hash as it was — and the docs promised the
 * opposite. The parts that did not change keep the object they had.
 */
let nav!: Navigator;
const renders = { hash: 0, query: 0 };

class HashReader extends Component {
  hook = this.use(Navigator);
  @created keep() {
    nav = this.hook;
  }
  render() {
    renders.hash++;
    return <i>{JSON.stringify(this.hook.hashParams)}</i>;
  }
}
class QueryReader extends Component {
  hook = this.use(Navigator);
  render() {
    renders.query++;
    return <b>{JSON.stringify(this.hook.searchParams)}</b>;
  }
}
const routes = createRoutes({ "/a": <p>a</p>, "/b": <p>b</p> });
class Shell extends Component {
  render() {
    return (
      <div>
        <HashReader />
        <QueryReader />
        <RouteOutlet routes={routes} />
      </div>
    );
  }
}
class App extends Component {
  router = this.use(Router);
  render(): RamondaNode {
    return <Shell />;
  }
}

beforeEach(() => {
  window.history.pushState(null, "", "/a?x=1#h=1");
});

describe("a component reading one part of the URL", () => {
  test("does not re-render when another part moves", async () => {
    render(<App />);
    const before = { ...renders };

    await act(async () => nav.push("/b?x=1#h=1"));
    expect(renders).toEqual(before);

    await act(async () => nav.updateSearchParams({ x: "2" }));
    expect(renders.hash).toBe(before.hash);
    expect(renders.query).toBe(before.query + 1);

    await act(async () => nav.updateHashParams({ h: "2" }));
    expect(renders.hash).toBe(before.hash + 1);
  });

  test("and does not re-render on back/forward that leaves its part as it was", async () => {
    render(<App />);
    const before = { ...renders };
    await act(async () => {
      window.history.pushState(null, "", "/b?x=1#h=1");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(renders).toEqual(before);
  });
});
