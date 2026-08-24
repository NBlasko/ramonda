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
