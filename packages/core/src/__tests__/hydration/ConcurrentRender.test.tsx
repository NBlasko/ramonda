import { describe, test, expect, beforeEach } from "vitest";
import { state, mounted, created, Host } from "../../base/decorators";
import { Component } from "../../base/Component";
import { renderToString } from "../../hydration/ssr";
import { getRenderEnv } from "../../core/renderEnv";
import { effectLike } from "../../test/effectLike";

/**
 * The render env is a module-level variable, and on the server module scope is
 * shared by every concurrent request. These lock the contract that makes that
 * safe (see `core/renderEnv.ts`): the flag is only live across a synchronous
 * root mount, and every component carries its own `env` from then on.
 */

let clientRan: string[] = [];
let serverRan: string[] = [];
let effectsRan: string[] = [];

beforeEach(() => {
  clientRan = [];
  serverRan = [];
  effectsRan = [];
});

/** Appears only after its parent's @mounted schedules an update — i.e. it is built
 *  during flushTaskQueue, after renderToString has already restored the flag. */
@Host("span")
class Late extends Component<{ tag: string }> {
  @created({ env: "client" }) onClient() {
    clientRan.push(this.props.tag);
  }
  @created({ env: "server" }) onServer() {
    serverRan.push(this.props.tag);
  }
  @effectLike() ranEffect() {
    effectsRan.push(this.props.tag);
  }
  render() {
    return <i>late-{this.props.tag}</i>;
  }
}

@Host("div")
class Reveals extends Component<{ tag: string }> {
  @state show = false;
  @mounted reveal() {
    this.show = true;
  }
  render() {
    return <div>{this.show ? <Late tag={this.props.tag} /> : null}</div>;
  }
}

@Host("div")
class Plain extends Component {
  render() {
    return <span>plain</span>;
  }
}

describe("render env: components built after the mount returns", () => {
  test("a component created during the flush is still on the server", async () => {
    const html = await renderToString(<Reveals tag="a" />);

    expect(html).toContain("late-a");
    // It was built from the task queue, long after the module flag went back to
    // "client" — it must still have inherited "server" from its parent.
    expect(serverRan).toEqual(["a"]);
    expect(clientRan).toEqual([]);
    expect(effectsRan).toEqual([]);
  });

  test("the module flag is already restored while the render is in flight", async () => {
    const pending = renderToString(<Reveals tag="a" />);

    // The mount is synchronous, so by the time renderToString has yielded the
    // flag is back — nothing after this point may depend on it.
    expect(getRenderEnv()).toBe("client");

    await pending;
    expect(clientRan).toEqual([]);
  });
});

describe("render env: concurrent renders", () => {
  test("two interleaved renders do not leak env into each other", async () => {
    const [first, second] = await Promise.all([
      renderToString(<Reveals tag="one" />),
      renderToString(<Reveals tag="two" />),
    ]);

    expect(first).toContain("late-one");
    expect(second).toContain("late-two");

    expect(serverRan.sort()).toEqual(["one", "two"]);
    expect(clientRan).toEqual([]);
    expect(effectsRan).toEqual([]);
  });

  test("a render that finishes early does not flip the flag under a slower one", async () => {
    // `Plain` has no queued work and settles first; `Reveals` still has a
    // component to build. With a flag restored in a `finally` after the await,
    // Plain's cleanup would land mid-flight of Reveals.
    const [plain, late] = await Promise.all([renderToString(<Plain />), renderToString(<Reveals tag="slow" />)]);

    expect(plain).toContain("plain");
    expect(late).toContain("late-slow");
    expect(serverRan).toEqual(["slow"]);
    expect(clientRan).toEqual([]);
    expect(effectsRan).toEqual([]);
  });

  test("a render whose work lands late still builds on the server", async () => {
    // The sharp edge. `Plain` has nothing queued, so it settles on the first
    // tick and finishes. `Deferred` schedules its state change from a microtask,
    // so at that moment the task queue is empty and nothing makes Plain wait.
    // With the flag restored in a `finally` after the await, Plain's cleanup
    // fires first and `Late` would then be built believing it is on the client.
    @Host("div")
    class Deferred extends Component<{ tag: string }> {
      @state show = false;
      @mounted reveal() {
        queueMicrotask(() => {
          this.show = true;
        });
      }
      render() {
        return <div>{this.show ? <Late tag={this.props.tag} /> : null}</div>;
      }
    }

    const [plain, deferred] = await Promise.all([
      renderToString(<Plain />),
      renderToString(<Deferred tag="deferred" />),
    ]);

    expect(plain).toContain("plain");
    expect(deferred).toContain("late-deferred");
    expect(serverRan).toEqual(["deferred"]);
    expect(clientRan).toEqual([]);
    expect(effectsRan).toEqual([]);
  });

  test("many concurrent renders each keep their own output", async () => {
    const tags = ["a", "b", "c", "d", "e"];
    const html = await Promise.all(tags.map((tag) => renderToString(<Reveals tag={tag} />)));

    html.forEach((out, i) => expect(out).toContain(`late-${tags[i]}`));
    expect(serverRan.sort()).toEqual([...tags].sort());
    expect(clientRan).toEqual([]);
    expect(effectsRan).toEqual([]);
  });
});

describe("render env: the client is unaffected", () => {
  test("a client render still runs client lifecycle and effects", async () => {
    const { getDOM } = await import("../../test/setup");

    const app = await getDOM<Reveals>(<Reveals tag="c" />);
    await app.settle();
    await app.settle();

    expect(clientRan).toEqual(["c"]);
    expect(serverRan).toEqual([]);
    expect(effectsRan).toEqual(["c"]);

    app.unmount();
  });
});
