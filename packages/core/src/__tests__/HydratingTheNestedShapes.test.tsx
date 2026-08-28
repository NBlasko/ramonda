import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component, ErrorBoundary, AsyncLoad, list } from "../index";
import { state } from "../base/decorators";
import { createContext } from "../base/Context";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";
import type { RamondaNode } from "../types/vdom";

/**
 * Queue item 6: everything items 3 to 5 built, served and then adopted.
 *
 * This is the half of the branch where the faults were: five of the eight findings in round four of
 * the range review were on this path. A shape that renders correctly twice can still be wrong here,
 * because hydration does not RENDER the server's markup — it walks it, and a client that expected a
 * different tree adopts the wrong nodes or reports a divergence on markup that was right.
 *
 * What is asserted every time: what the reader sees BEFORE any script runs, what the page holds
 * after adoption, and that no diagnostic fired. The third is the point of the file. A page can end
 * up correct because the client rebuilt what it could not adopt, and the only sign of that is the
 * report.
 */
const [ThemeProvider, ThemeConsumer] = createContext({ label: "none" });

class Reader extends Component {
  theme = this.use(ThemeConsumer);
  render() {
    return <span className="read">{this.theme.label}</span>;
  }
}

/** Provides `inner`, and renders whatever slot it is handed inside it. */
class Inner extends Component<{ slot?: RamondaNode }> {
  provider = this.use(ThemeProvider, () => ({ label: "inner" }));
  render() {
    return <div className="inner">{this.props.slot}</div>;
  }
}

const codes: string[] = [];
const collect = (event: Event) => {
  const message = (event as CustomEvent).detail?.message as string;
  const code = message?.match(/^\[(RMD\d+)\]/)?.[1];
  if (code) codes.push(code);
};

/** Serve, adopt, and report what the reader saw at each step. */
async function roundTrip(vnode: RamondaNode) {
  const html = await renderToString(vnode as never);
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.innerHTML = html;

  const beforeScripts = container.textContent;
  /**
   * A node the server built, held by IDENTITY.
   *
   * Text alone cannot say whether hydration adopted the markup or threw it away and built the same
   * thing again — both read identically. Measured with adoption disabled, two of these tests stayed
   * green on text and only this told them apart.
   */
  const servedNode = container.querySelector("*");
  codes.length = 0;

  hydrateRoot(vnode as never, container);
  await Promise.resolve();
  await Promise.resolve();

  const afterHydration = container.textContent;
  const adopted = servedNode !== null && container.contains(servedNode);
  const reported = [...codes];
  container.remove();
  return { beforeScripts, afterHydration, adopted, reported };
}

describe("the nested shapes survive being served and adopted", () => {
  beforeEach(() => {
    window.addEventListener("ramonda:dev-log", collect);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    window.removeEventListener("ramonda:dev-log", collect);
    vi.restoreAllMocks();
  });

  /** Item 3's rule, on the path where it could quietly resolve differently. */
  test("a slot still reads the context it lands under", async () => {
    class Outer extends Component {
      provider = this.use(ThemeProvider, () => ({ label: "outer" }));
      render() {
        return <Inner slot={<Reader />} />;
      }
    }

    expect(await roundTrip(<Outer />)).toEqual({
      beforeScripts: "inner",
      afterHydration: "inner",
      adopted: true,
      reported: [],
    });
  });

  test("a list inside a slot is adopted rather than rebuilt", async () => {
    class Rows extends Component {
      @state rows = [{ id: "a" }, { id: "b" }];
      render() {
        return (
          <Inner
            slot={list(this.rows, (row) => (
              <b className="row" key={row.id}>
                {row.id}
              </b>
            ))}
          />
        );
      }
    }

    expect(await roundTrip(<Rows />)).toEqual({
      beforeScripts: "ab",
      afterHydration: "ab",
      adopted: true,
      reported: [],
    });
  });

  /**
   * The server WAITS for the module and serves what it rendered, so the reader never sees the
   * loading fallback — and the client adopts that rather than showing the fallback and swapping it
   * back in. A load left pending on the server would hold the render open instead; there is no
   * round limit that catches a promise which simply never settles.
   */
  test("an AsyncLoad in a list in a slot is served loaded", async () => {
    class Loaded extends Component<{ text: string }> {
      render() {
        return <b className="row">{this.props.text}</b>;
      }
    }
    class WithAsync extends Component {
      render() {
        return (
          <Inner
            slot={list([{ id: "s1" }], (row) => (
              <AsyncLoad
                key={row.id}
                lazy={() => Promise.resolve({ default: Loaded })}
                cacheKey="hydrating-async"
                onLoading={<i className="wait">…</i>}
                errorFallback={<i className="err">x</i>}
                loadedProps={{ text: row.id }}
              />
            ))}
          />
        );
      }
    }

    expect(await roundTrip(<WithAsync />)).toEqual({
      beforeScripts: "s1",
      afterHydration: "s1",
      adopted: true,
      reported: [],
    });
  });

  /** A boundary that catches on the server serves its fallback, and the client adopts THAT. */
  test("a throw on both sides serves the fallback and adopts it", async () => {
    class AlwaysBad extends Component {
      render(): never {
        throw new Error("boom");
      }
    }
    class Guarded extends Component {
      render() {
        return (
          <ErrorBoundary fallback={() => <i className="caught">caught</i>}>
            <Inner slot={<AlwaysBad />} />
          </ErrorBoundary>
        );
      }
    }

    expect(await roundTrip(<Guarded />)).toEqual({
      beforeScripts: "caught",
      afterHydration: "caught",
      adopted: true,
      reported: [],
    });
  });

  /**
   * The shape hydration cannot see coming: the server rendered fine and the CLIENT throws.
   *
   * The reader gets a correct page immediately and the boundary swaps in the fallback when the
   * bundle arrives — which is the honest outcome, since the client cannot go on driving a subtree
   * whose render fails. What matters is that the throw is caught during ADOPTION at all: a boundary
   * that only worked on a fresh render would let this escape and take the page down after it had
   * already been shown.
   */
  test("fine on the server and throwing on the client is caught during adoption", async () => {
    let onClient = false;
    class ClientOnlyBad extends Component {
      render() {
        if (onClient) throw new Error("client boom");
        return <b className="ok">server ok</b>;
      }
    }
    class Guarded extends Component {
      render() {
        return (
          <ErrorBoundary fallback={() => <i className="caught">caught</i>}>
            <Inner slot={<ClientOnlyBad />} />
          </ErrorBoundary>
        );
      }
    }

    const html = await renderToString(<Guarded />);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;
    expect(container.textContent).toBe("server ok");

    onClient = true;
    codes.length = 0;
    hydrateRoot(<Guarded />, container);
    await Promise.resolve();
    await Promise.resolve();

    const after = container.textContent;
    const reported = [...codes];
    container.remove();

    expect({ after, reported }).toEqual({ after: "caught", reported: [] });
  });
});
