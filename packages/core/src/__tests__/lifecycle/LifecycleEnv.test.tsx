import { describe, test, expect, beforeEach } from "vitest";
import { getDOM } from "../../test/setup";
import { renderToString } from "../../hydration/ssr";
import { mount, create, destroy } from "../../base/decorators";
import { Component } from "../../base/Component";
import type { RenderEnv } from "../../core/renderEnv";

/**
 * `@create`/`@mount`/`@destroy` receive the concrete render side as their
 * argument, so a shared method can branch (e.g. skip a fetch on the server)
 * without a fragile `typeof window` check — unreliable anyway, since SSR runs
 * under a DOM shim where `window` exists.
 */
let seen: Record<string, RenderEnv | undefined>;

beforeEach(() => {
  seen = {};
});

class Probe extends Component {
  @create init(env: RenderEnv) {
    seen.create = env;
  }
  @mount up(env: RenderEnv) {
    seen.mount = env;
  }
  @destroy down(env: RenderEnv) {
    seen.destroy = env;
  }
  render() {
    return <div>probe</div>;
  }
}

describe("lifecycle env argument", () => {
  test("on the client, @create and @mount receive 'client'", async () => {
    const app = await getDOM<Probe>(<Probe />);
    await app.settle();

    expect(seen.create).toBe("client");
    expect(seen.mount).toBe("client");
  });

  test("@destroy receives 'client' on unmount", async () => {
    const app = await getDOM<Probe>(<Probe />);
    await app.settle();
    app.unmount();

    expect(seen.destroy).toBe("client");
  });

  test("during renderToString, @create and @mount receive 'server'", async () => {
    await renderToString(<Probe />);

    expect(seen.create).toBe("server");
    expect(seen.mount).toBe("server");
  });

  test("a lifecycle method that declares no parameter still runs", async () => {
    // Fewer params is assignable, so ignoring the env is fine — the point is
    // that adding the argument didn't break the plain no-arg form.
    let ran = false;
    class NoArg extends Component {
      @mount up() {
        ran = true;
      }
      render() {
        return <div>x</div>;
      }
    }
    const app = await getDOM<NoArg>(<NoArg />);
    await app.settle();

    expect(ran).toBe(true);
  });
});
