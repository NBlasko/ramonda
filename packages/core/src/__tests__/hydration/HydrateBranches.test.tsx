import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Component } from "../../base/Component";
import { Host, state, create, mount, deferHydration } from "../../base/decorators";
import { hydrateRoot } from "../../hydration/hydrate";
import { renderToString } from "../../hydration/ssr";
import { resetDiagnostics } from "../../debug/diagnostics";
import { STATE_ATTR } from "../../helpers/constants";

/**
 * The adopt path's edge branches — the ones the happy-path round-trip tests never
 * reach: a filtered-out root, a corrupt state blob, a client-only `@create`, a
 * shape that diverges from the server's, several deferrals at once, and a deferral
 * that never resumes.
 */

function captureDiagnostics() {
  const codes: string[] = [];
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail as { message: string };
    const code = detail.message.match(/^\[(RMD\d+)\]/)?.[1];
    if (code) codes.push(code);
  };
  window.addEventListener("ramonda:dev-log", handler);
  return { codes, stop: () => window.removeEventListener("ramonda:dev-log", handler) };
}

async function serverHtmlInto(vnode: Parameters<typeof renderToString>[0]): Promise<HTMLElement> {
  const html = await renderToString(vnode);
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.innerHTML = html;
  return container;
}

const afterATick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

// Flipped between the server and client render to force a shape divergence.
let SIDE = "server";
let captured: ReturnType<typeof captureDiagnostics>;

beforeEach(() => {
  resetDiagnostics();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  captured = captureDiagnostics();
  SIDE = "server";
});
afterEach(() => {
  captured.stop();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("hydrateRoot", () => {
  test("a root that filters to nothing is a no-op", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = "<p>left alone</p>";

    expect(() => hydrateRoot(false as unknown as Parameters<typeof hydrateRoot>[0], container)).not.toThrow();
    expect(container.innerHTML).toBe("<p>left alone</p>");
  });
});

describe("state restore", () => {
  test("a corrupt state blob is swallowed — hydration carries on", async () => {
    @Host("div")
    class Card extends Component {
      @state msg = "hello";
      render() {
        return <span>{this.msg}</span>;
      }
    }

    const container = await serverHtmlInto(<Card />);
    // Corrupt the blob the client is about to restore from.
    container.firstElementChild!.setAttribute(STATE_ATTR, "{ not: valid json");

    expect(() => hydrateRoot(<Card />, container)).not.toThrow();
    // The restore failed, so the field keeps its initializer — which happens to be
    // what the server rendered, and the page is still there.
    expect(container.textContent).toBe("hello");
  });
});

describe("client-only @create", () => {
  test("runs on hydration, having been skipped on the server", async () => {
    let ranOn = "";

    @Host("div")
    class Guarded extends Component {
      @create({ env: "client" }) init() {
        ranOn = SIDE;
      }
      render() {
        return <span>x</span>;
      }
    }

    SIDE = "server";
    const container = await serverHtmlInto(<Guarded />);
    // The client @create must NOT have run during the server render.
    expect(ranOn).toBe("");

    SIDE = "client";
    hydrateRoot(<Guarded />, container);
    expect(ranOn).toBe("client");
  });
});

describe("a SHARED @create and a SHARED @mount part company on hydration", () => {
  /**
   * The distinction a route guard rests on, so it is worth a test of its own rather than being
   * inferred from the two halves above.
   *
   * `@create` is initialisation: the server ran it and what it wrote was serialized into the page,
   * so running it again would recompute over a value that has already been restored. `@mount`
   * touches the real DOM, and the DOM the server built was thrown away and rebuilt as the client
   * adopted it — so it has to run again.
   *
   * The consequence for a guard: a cached page, or a CDN serving one file for many paths, can put
   * markup in front of someone the server never checked. A check in `@mount` fires on that
   * hydration. A check in a plain `@create` does not. See routing/server.md.
   */
  test("@create is skipped, @mount runs again", async () => {
    const ran: string[] = [];

    @Host("div")
    class Both extends Component {
      @create init() {
        ran.push(`create:${SIDE}`);
      }
      @mount ready() {
        ran.push(`mount:${SIDE}`);
      }
      render() {
        return <span>x</span>;
      }
    }

    SIDE = "server";
    const container = await serverHtmlInto(<Both />);
    expect(ran).toEqual(["create:server", "mount:server"]);

    SIDE = "client";
    hydrateRoot(<Both />, container);
    await Promise.resolve();

    // No second "create:client" — that is the whole point.
    expect(ran).toEqual(["create:server", "mount:server", "mount:client"]);
  });
});

describe("shape divergence", () => {
  test("text expected where the server wrote an element → the text is inserted", async () => {
    @Host("div")
    class Flip extends Component {
      render() {
        return <div>{SIDE === "server" ? <b>B</b> : "T"}</div>;
      }
    }

    SIDE = "server";
    const container = await serverHtmlInto(<Flip />);

    SIDE = "client";
    hydrateRoot(<Flip />, container);

    expect(container.textContent).toContain("T");
    expect(captured.codes.length).toBeGreaterThan(0);
  });

  test("text expected where the server wrote nothing → the text is appended", async () => {
    @Host("div")
    class Flip extends Component {
      render() {
        return <div>{SIDE === "server" ? null : "T"}</div>;
      }
    }

    SIDE = "server";
    const container = await serverHtmlInto(<Flip />);

    SIDE = "client";
    hydrateRoot(<Flip />, container);

    expect(container.querySelector("div")?.textContent).toBe("T");
    expect(captured.codes.length).toBeGreaterThan(0);
  });

  test("a host of the wrong element falls back to building fresh", () => {
    @Host("section")
    class Panel extends Component {
      render() {
        return <p>panel</p>;
      }
    }

    // Server markup whose host tag is a <div>, not the <section> the client renders.
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = "<div><p>panel</p></div>";

    hydrateRoot(<Panel />, container);

    // Adoption was refused; the client built its own <section>.
    expect(container.querySelector("section")).not.toBeNull();
    expect(container.textContent).toContain("panel");
    expect(captured.codes.length).toBeGreaterThan(0);
  });
});

describe("deferred hydration", () => {
  test("several deferrals are awaited together, then the subtree resumes", async () => {
    @Host("div")
    class TwoWaits extends Component {
      @state a = false;
      @state b = false;
      @deferHydration one() {
        return afterATick().then(() => {
          this.a = true;
        });
      }
      @deferHydration two() {
        return afterATick().then(() => {
          this.b = true;
        });
      }
      render() {
        return <p>{this.a && this.b ? "both" : "waiting"}</p>;
      }
    }

    const container = await serverHtmlInto(<TwoWaits />);
    hydrateRoot(<TwoWaits />, container);

    // Both promises still pending → the server's markup is untouched.
    expect(container.textContent).toContain("waiting");

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(container.textContent).toContain("both");
  });

  test("a deferral that never settles is reported as stalled (RMD017)", async () => {
    @Host("div")
    class Stuck extends Component {
      @deferHydration wait() {
        return new Promise<void>(() => {
          /* never resolves */
        });
      }
      render() {
        return <p>stuck</p>;
      }
    }

    const container = await serverHtmlInto(<Stuck />);

    vi.useFakeTimers();
    try {
      hydrateRoot(<Stuck />, container);
      // The 10s stall watchdog fires.
      vi.advanceTimersByTime(10_000);
      expect(captured.codes).toContain("RMD017");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("deferred hydration that resolves late into a changed page", () => {
  @Host("section")
  class Slow extends Component {
    @deferHydration wait() {
      return afterATick();
    }
    render() {
      return <p>slow</p>;
    }
  }

  test("resuming to a host the server didn't write falls back to building", async () => {
    // The server wrote a <div>, but the component's host is a <section>. Adoption
    // is deferred, so the divergence is only discovered when it resumes.
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = "<div><p>slow</p></div>";

    hydrateRoot(<Slow />, container);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(container.querySelector("section")).not.toBeNull();
    expect(container.textContent).toContain("slow");
  });

  test("a host detached before the deferral resolves is left alone", async () => {
    const container = await serverHtmlInto(<Slow />);
    hydrateRoot(<Slow />, container);

    // Pull the host out of the document while the deferral is still pending.
    container.firstElementChild!.remove();

    await expect(
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
      })(),
    ).resolves.toBeUndefined();
    expect(container.firstElementChild).toBeNull();
  });

  test("a component destroyed before the deferral resolves does not resume into a dead tree", async () => {
    const { unmount } = await import("../../index");
    const container = await serverHtmlInto(<Slow />);
    hydrateRoot(<Slow />, container);

    unmount(container); // @destroy → isDestroyed, before the promise settles

    let threw = false;
    await new Promise((resolve) => setTimeout(resolve, 40)).catch(() => {
      threw = true;
    });
    expect(threw).toBe(false);
  });
});
