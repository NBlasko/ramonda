import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { state, mounted } from "../../base/decorators";
import { Component } from "../../base/Component";
import { hydrateRoot } from "../../hydration/hydrate";
import { renderToString } from "../../hydration/ssr";
import { resetDiagnostics } from "../../debug/diagnostics";

/**
 * Collects diagnostics off the dev-log channel instead of scraping console.
 * `all` keeps every dev log, not just coded ones: "this markup hydrates
 * cleanly" has to mean total silence, or a check that merely stopped using a
 * diagnostic code would still look like it passed.
 */
function captureDiagnostics() {
  const codes: string[] = [];
  const messages: string[] = [];
  const all: string[] = [];
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail as { message: string };
    all.push(detail.message);
    const code = detail.message.match(/^\[(RMD\d+)\]/)?.[1];
    if (!code) return;
    codes.push(code);
    messages.push(detail.message);
  };
  window.addEventListener("ramonda:dev-log", handler);
  return {
    codes,
    messages,
    all,
    stop: () => window.removeEventListener("ramonda:dev-log", handler),
  };
}

/**
 * Renders to HTML, then parses it into a detached container — the round-trip
 * through markup is the point, since that is what fuses adjacent text nodes.
 */
async function serverHtmlInto(vnode: Parameters<typeof renderToString>[0]) {
  const html = await renderToString(vnode);
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.innerHTML = html;
  return container;
}

/**
 * Stands in for anything that differs across the boundary — `new Date()`,
 * `Math.random()`, `typeof window`. Flipping it between the two renders
 * reproduces a mismatch deterministically.
 */
let SIDE = "server";

describe("hydration mismatch (RMD007)", () => {
  let captured: ReturnType<typeof captureDiagnostics>;

  beforeEach(() => {
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation(() => {});
    captured = captureDiagnostics();
    SIDE = "server";
  });

  afterEach(() => {
    captured.stop();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  test("matching output hydrates silently", async () => {
    class Greeting extends Component {
      render() {
        return (
          <div>
            <span>Hello {"Nikola"}!</span>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Greeting />);
    hydrateRoot(<Greeting />, container);

    // Not just "no RMD007" — nothing at all. `Hello {name}!` is the most
    // ordinary JSX there is, and it used to warn twice about text it had itself
    // fused; a mismatch check that cried wolf here would be worthless.
    expect(captured.all).toEqual([]);
    expect(container.querySelector("span")!.textContent).toBe("Hello Nikola!");
  });

  test("adjacent text children are adopted, not rebuilt", async () => {
    class Greeting extends Component {
      render() {
        return (
          <div>
            <span>Hello {"Nikola"}!</span>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Greeting />);
    const span = container.querySelector("span")!;

    // Serializing to HTML drops the boundaries: three text children come back
    // fused into one node.
    expect(span.childNodes.length).toBe(1);
    const serverTextNode = span.firstChild;

    hydrateRoot(<Greeting />, container);

    // splitText restores the boundaries the vnode expects...
    expect(span.childNodes.length).toBe(3);
    expect(Array.from(span.childNodes).map((n) => n.textContent)).toEqual(["Hello ", "Nikola", "!"]);
    // ...by slicing the server's own node, not replacing it. Identity is the
    // whole point of hydration: adopt the server DOM, never rebuild it.
    expect(span.firstChild).toBe(serverTextNode);
    // The load-bearing assertion. Rebuilding the run node-by-node happens to
    // land on the same shape and the same firstChild, so only the silence
    // distinguishes adopting from rebuilding.
    expect(captured.all).toEqual([]);
  });

  test("a text value that differs across the boundary reports RMD007", async () => {
    class Clock extends Component {
      render() {
        return (
          <div>
            <span>{SIDE}</span>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Clock />);
    SIDE = "client";
    hydrateRoot(<Clock />, container);

    expect(captured.codes).toEqual(["RMD007"]);
    expect(captured.messages[0]).toContain('rendered the text "client"');
    expect(captured.messages[0]).toContain('the server sent "server"');
  });

  test("a mismatch inside a fused run is pinpointed and still repaired", async () => {
    class Greeting extends Component {
      render() {
        return (
          <div>
            <span>Hello {SIDE}!</span>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Greeting />);
    expect(container.querySelector("span")!.textContent).toBe("Hello server!");

    SIDE = "client";
    hydrateRoot(<Greeting />, container);

    // "Hello " matched and split cleanly; only the middle child diverged.
    expect(captured.codes).toEqual(["RMD007"]);
    expect(captured.messages[0]).toContain('rendered the text "client"');
    expect(container.querySelector("span")!.textContent).toBe("Hello client!");
  });

  test("an attribute that differs across the boundary reports RMD007", async () => {
    class Themed extends Component {
      render() {
        return (
          <div>
            <span className={SIDE} title={SIDE}>
              hi
            </span>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Themed />);
    SIDE = "client";
    hydrateRoot(<Themed />, container);

    expect(captured.codes).toEqual(["RMD007", "RMD007"]);
    expect(captured.messages.join("\n")).toContain('class="client"');
    expect(captured.messages.join("\n")).toContain('class="server"');
  });

  /**
   * The server's copy of a style goes through the DOM, which rewrites it: it
   * lowercases the property, trims, and appends a trailing `;`. The client's
   * copy is the raw string from JSX. Comparing the two as TEXT reported a
   * mismatch for styles that render identically — which is what made RMD007
   * fire on markup that was entirely correct. Inline styles are legal; the
   * comparator was wrong.
   */
  test("a style the DOM rewrites is not a mismatch", async () => {
    class Styled extends Component {
      render() {
        // None of these survive a DOM round-trip unchanged: no trailing
        // semicolon, an uppercase property, and loose spacing.
        return (
          <div>
            <span style="COLOR:red;   font-weight: bold">hi</span>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Styled />);
    hydrateRoot(<Styled />, container);

    expect(captured.all).toEqual([]);
  });

  test("a style that genuinely differs still reports RMD007", async () => {
    class Styled extends Component {
      render() {
        return (
          <div>
            <span style={`color: ${SIDE === "server" ? "red" : "blue"}`}>hi</span>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Styled />);
    SIDE = "client";
    hydrateRoot(<Styled />, container);

    // Normalizing must not turn the comparison off: a different VALUE for the
    // same property is exactly what the check exists to catch.
    expect(captured.codes).toEqual(["RMD007"]);
    expect(captured.messages.join("\n")).toContain("blue");
  });

  test("a declaration the server dropped reports RMD007", async () => {
    class Styled extends Component {
      render() {
        return (
          <div>
            <span style={SIDE === "server" ? "color: red" : "color: red; display: none"}>hi</span>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Styled />);
    SIDE = "client";
    hydrateRoot(<Styled />, container);

    // Sorting the declarations must not make a MISSING one compare equal.
    expect(captured.codes).toEqual(["RMD007"]);
  });

  test("a different element reports RMD007", async () => {
    class Swap extends Component {
      render() {
        return <div>{SIDE === "server" ? <span>x</span> : <b>x</b>}</div>;
      }
    }

    const container = await serverHtmlInto(<Swap />);
    SIDE = "client";
    hydrateRoot(<Swap />, container);

    expect(captured.codes).toEqual(["RMD007"]);
    expect(captured.messages[0]).toContain("rendered <b>");
    expect(captured.messages[0]).toContain("the server sent <span>");
  });

  test("extra server children report RMD007", async () => {
    class List extends Component {
      render() {
        return (
          <div>
            <ul>
              {SIDE === "server" ? <li>a</li> : null}
              <li>b</li>
            </ul>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<List />);
    expect(container.querySelectorAll("li").length).toBe(2);

    SIDE = "client";
    hydrateRoot(<List />, container);

    expect(captured.codes).toContain("RMD007");
    expect(captured.messages.join("\n")).toContain("the server sent");
  });

  test("a component whose block is longer on the server keeps the siblings after it", async () => {
    /**
     * The client renders FEWER children than the server wrote for one component.
     *
     * A component owns a RUN of siblings, and the markers are the only thing that says where that run
     * ends. Adopting one child of a two-child block leaves the walk standing on the server's second
     * node — inside the block, in the middle of the parent's level — so everything the parent has
     * left is matched one position too early: the sibling AFTER the component is diffed against a
     * node that belongs to the component, and the closing marker stays in the page.
     */
    class Inner extends Component {
      render() {
        return SIDE === "server" ? [<b>one</b>, <i>two</i>] : [<b>one</b>];
      }
    }

    class Page extends Component {
      render() {
        return (
          <div>
            <Inner />
            <span id="after">after</span>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Page />);
    expect(container.querySelectorAll("b, i").length).toBe(2);

    SIDE = "client";
    hydrateRoot(<Page />, container);

    // Exactly what a client-side render produces: the extra node gone, the sibling intact, and no
    // marker left behind.
    expect(container.innerHTML).toBe('<div><b>one</b><span id="after">after</span></div>');
    expect(container.querySelector("#after")!.textContent).toBe("after");

    // Reported as what it is — a render that disagreed — rather than as a block the server failed to
    // close, which is a different fault and sends the reader looking in the wrong place.
    expect(captured.codes).toContain("RMD007");
    expect(captured.messages.join("\n")).not.toContain("no closing marker");
  });

  test("a dropped child that is itself a component does not confuse the block's end", async () => {
    // The leftover run holds a whole component's markers, so "the first `/c…` after the cursor" is
    // the NESTED one. Stopping there leaves the outer block's own marker in the page and puts the
    // walk back inside a block it thinks it has left.
    class Nested extends Component {
      render() {
        return <em>nested</em>;
      }
    }

    class Inner extends Component {
      render() {
        return SIDE === "server" ? [<b>one</b>, <Nested />] : [<b>one</b>];
      }
    }

    class Page extends Component {
      render() {
        return (
          <div>
            <Inner />
            <span id="after">after</span>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Page />);
    expect(container.querySelector("em")).not.toBeNull();

    SIDE = "client";
    hydrateRoot(<Page />, container);

    expect(container.innerHTML).toBe('<div><b>one</b><span id="after">after</span></div>');
  });

  test("a block the server never closed is reported and left alone", async () => {
    /**
     * The one shape that cannot be repaired: with no closing marker anywhere after the cursor there
     * is no way to say where the component's run ends, and guessing takes a sibling with it. So the
     * walk stops, says so, and touches nothing after it.
     *
     * Reached by cutting the marker out of the served markup, which is what a truncated response or
     * a sanitizer that strips comments leaves behind.
     */
    class Inner extends Component {
      render() {
        return <b id="inner">inner</b>;
      }
    }
    class Page extends Component {
      render() {
        return (
          <div>
            <Inner />
            <span id="after">after</span>
          </div>
        );
      }
    }

    const html = await renderToString(<Page />);
    expect(html).toMatch(/<!--\/c\d+-->/);

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html.replace(/<!--\/c\d+-->/, "");

    hydrateRoot(<Page />, container);

    expect(captured.codes).toContain("RMD007");
    expect(captured.messages.join("\n")).toContain("no closing marker");

    // Both are still there, exactly once each: nothing was deleted on a guess.
    expect(container.querySelectorAll("#inner")).toHaveLength(1);
    expect(container.querySelectorAll("#after")).toHaveLength(1);
    container.remove();
  });

  test("a child the server never wrote is built and appended", async () => {
    /**
     * The client's level is LONGER than the server's, and the extra child is the last one — so the
     * walk runs out of nodes rather than finding a wrong one. There is nothing to replace, and the
     * node is appended.
     */
    class Page extends Component {
      render() {
        return (
          <div id="shell">
            <span id="one">one</span>
            {SIDE === "client" ? <span id="two">two</span> : null}
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Page />);
    const one = container.querySelector("#one")!;

    SIDE = "client";
    hydrateRoot(<Page />, container);

    expect(container.querySelector("#shell")!.innerHTML).toBe(
      '<span id="one">one</span><span id="two">two</span>',
    );
    // The server's node was adopted, not rebuilt to make room for the new one.
    expect(container.querySelector("#one")).toBe(one);
    expect(captured.codes).toContain("RMD007");
  });

  test("the prescribed two-pass pattern hydrates without a mismatch", async () => {
    // This is the fix RMD007 tells people to use instead of `typeof window`.
    // It must not trip the very diagnostic that recommends it.
    class Widget extends Component {
      @state isClient = false;

      @mounted({ env: "client" })
      markClient() {
        this.isClient = true;
      }

      render() {
        return (
          <div>
            <span>{this.isClient ? "interactive" : "static"}</span>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Widget />);
    expect(container.querySelector("span")!.textContent).toBe("static");

    hydrateRoot(<Widget />, container);

    // The hydrating render still sees isClient === false, so it matches the
    // server exactly; the switch happens on the re-render a tick later.
    expect(captured.all).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector("span")!.textContent).toBe("interactive");
  });
});
