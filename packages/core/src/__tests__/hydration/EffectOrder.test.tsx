import { instanceOf } from "../../test/setup";
import { describe, test, expect, beforeEach } from "vitest";
import { Component } from "../../base/Component";
import { mounted, state } from "../../base/decorators";
import { renderPage } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";
import { bootstrap } from "../../index";
import { effectLike } from "../../test/effectLike";

/**
 * A component's effects run AFTER its children's — on every path, including the
 * one where hydration and a fresh build meet.
 *
 * `hydrateComponent` used to call `runComponentEffects` inline while the build
 * path deferred it to the post-commit flush. Both orders were self-consistent,
 * so a fully-hydrated page and a fully-built page each looked correct on their
 * own. Real pages mix them: anything hydration cannot adopt is built instead.
 *
 * Measured on a hydrated parent with a newly-built child: `["parent", "child"]`,
 * exactly inverted — so a parent's effect could not see what a child's effect had
 * done. Found by a docs demo counting a store's subscribers, which read zero on
 * the live site while every test here said one.
 */

const order: string[] = [];

class Child extends Component {
  @effectLike() e() {
    order.push("child:effect");
  }
  @mounted m() {
    order.push("child:mount");
  }
  render() {
    return (
      <span>
        <b>x</b>
      </span>
    );
  }
}

class Panel extends Component<{ withChild: boolean }> {
  @effectLike() e() {
    order.push("parent:effect");
  }
  @mounted m() {
    order.push("parent:mount");
  }
  render() {
    return (
      <div>
        <p>{this.props.withChild ? <Child /> : null}</p>
      </div>
    );
  }
}

function mountInto(vnode: Parameters<typeof bootstrap>[0]) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  bootstrap(vnode, element);
  return element;
}

beforeEach(() => {
  order.length = 0;
});

describe("effects run children-first on an UPDATE too", () => {
  test("a re-render that creates a child runs the child's effects first", async () => {
    // The third path, and the one with no test until a docs demo caught it.
    // `updateBuild` used to call runComponentEffects inline, right after its own
    // diff — but that diff can CREATE components, and a new one defers its
    // effects to the post-commit flush. So on any update that mounts a child,
    // the parent's effect ran first.
    //
    // Measured on a subscriber being remounted: the parent counted the store's
    // listeners as 0 immediately afterwards, because its own effect had run
    // before the child subscribed.
    class Toggler extends Component {
      @state on = false;
      @effectLike() e() {
        // Reading `on` is what makes this effect re-run when it changes — the
        // same shape as an effect that observes something a child set up.
        void this.on;
        order.push("parent:effect");
      }
      render() {
        return (
          <div>
            <p>{this.on ? <Child /> : null}</p>
          </div>
        );
      }
    }

    const element = mountInto(<Toggler />);
    const instance = instanceOf<Toggler>(element.firstChild);
    order.length = 0;

    instance.on = true;
    await Promise.resolve();
    await Promise.resolve();

    expect(order.filter((e) => e.endsWith("effect"))).toEqual(["child:effect", "parent:effect"]);
    element.remove();
  });
});

describe("effects run children-first on every path", () => {
  test("a fresh build", () => {
    const element = mountInto(<Panel withChild={true} />);
    expect(order.filter((e) => e.endsWith("effect"))).toEqual(["child:effect", "parent:effect"]);
    element.remove();
  });

  test("a fully hydrated tree", async () => {
    const page = await renderPage(<Panel withChild={true} />);
    order.length = 0;

    const element = document.createElement("div");
    document.body.appendChild(element);
    element.innerHTML = page.body;
    hydrateRoot(<Panel withChild={true} />, element);
    await Promise.resolve();

    expect(order.filter((e) => e.endsWith("effect"))).toEqual(["child:effect", "parent:effect"]);
    element.remove();
  });

  test("a hydrated parent whose child had to be built", async () => {
    // The server rendered no child; the client renders one. So the parent is
    // adopted and the child is built — the mixed case, which is the common one
    // on any page where the two sides differ at all.
    const page = await renderPage(<Panel withChild={false} />);
    order.length = 0;

    const element = document.createElement("div");
    document.body.appendChild(element);
    element.innerHTML = page.body;
    hydrateRoot(<Panel withChild={true} />, element);
    await Promise.resolve();

    expect(order.filter((e) => e.endsWith("effect"))).toEqual(["child:effect", "parent:effect"]);
    element.remove();
  });

  /**
   * RESOLVED 2026-07-21 — a shared @mounted DOES run on hydration.
   *
   * It used to be skipped: hydration queued only `env === "client"`, on the
   * argument that a shared @mounted had already run during the server render. That
   * argument does not hold. @mounted exists to touch the REAL DOM, and the server's
   * DOM is thrown away — so skipping it on the client meant the work never
   * happened at all on a prerendered page.
   *
   * `AsyncLoad` is the proof, and it is why this was settled rather than left
   * open: its `@mounted` is what calls `load()`, so a prerendered page never
   * fetched its module and sat on the loading fallback forever.
   *
   * Anything that must run on the server only says so with `env: "server"`.
   */
  test("a shared @mounted runs on hydration, like it does on a build", async () => {
    const page = await renderPage(<Panel withChild={false} />);
    order.length = 0;

    const element = document.createElement("div");
    document.body.appendChild(element);
    element.innerHTML = page.body;
    hydrateRoot(<Panel withChild={true} />, element);
    await Promise.resolve();

    // Per component: mount before its own effects; children before parents.
    expect(order).toEqual(["child:mount", "child:effect", "parent:mount", "parent:effect"]);
    element.remove();
  });
});
