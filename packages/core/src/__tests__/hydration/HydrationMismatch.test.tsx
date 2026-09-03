import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { state, mounted, created } from "../../base/decorators";
import { Component } from "../../base/Component";
import { hydrateRoot } from "../../hydration/hydrate";
import { renderToString } from "../../hydration/ssr";
import { resetDiagnostics } from "../../debug/diagnostics";
import { unnamed } from "../../test/setup";

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

  /**
   * The subject of the message when the component has no class name.
   *
   * `root` is this file's word for markup no component produced. A class expression assigned to
   * nothing has a `name` of `""`, and `??` gave it `root` — so the report blamed the root for a
   * component's markup, and every nameless component shared one dedup key. The full family of this
   * fault, and why only the decorator-free paths can reach it, is in
   * `__tests__/AComponentWithNoName.test.tsx`.
   */
  test("a nameless component is not reported as the root", async () => {
    const Anon = unnamed(
      () =>
        class extends Component {
          render() {
            return (
              <div>
                <span>{SIDE}</span>
              </div>
            );
          }
        },
    );
    expect(Anon.name).toBe("");

    const container = await serverHtmlInto((<Anon />) as never);
    SIDE = "client";
    hydrateRoot((<Anon />) as never, container);

    expect(captured.codes).toEqual(["RMD007"]);
    expect(captured.messages[0]).toContain("<Unknown />");
    expect(captured.messages[0]).not.toContain("<root />");
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

  test("a client text SHORTER than the server's leaves no tail behind", async () => {
    /**
     * The repair cuts the server's node to the length this child rendered and leaves the tail for
     * the children after it — which is right when there ARE children after it, because a fused run
     * arrives as one node and each of them takes its own slice.
     *
     * With no child left to claim it, the tail is a fragment of the server's text belonging to
     * nobody, and it stayed in the page: measured on a `<span>` reading `waiting` on the server and
     * `ready` on the client, which hydrated to `readyng`.
     */
    class Status extends Component {
      render() {
        return (
          <div>
            <span id="s">{SIDE === "server" ? "waiting" : "ready"}</span>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Status />);
    expect(container.querySelector("#s")!.textContent).toBe("waiting");

    SIDE = "client";
    hydrateRoot(<Status />, container);

    expect(container.querySelector("#s")!.textContent).toBe("ready");
    expect(container.querySelector("#s")!.childNodes).toHaveLength(1);
    // One fault, one diagnostic: the tail is not reported as a child the server sent.
    expect(captured.codes).toEqual(["RMD007"]);
  });

  test("a diverging text child does not displace the component after it", async () => {
    /**
     * The repair cuts the server's node to the length this child rendered and leaves the tail for
     * the children after it — which only a TEXT child can claim. A component in that position looks
     * for its opening marker, finds a `Text`, and builds itself from scratch: its blob is never
     * read, its `shared` `@created` runs again, and the server's whole block is left standing behind
     * the fresh copy.
     *
     * Measured on the shape below — a count that moved between the render and the hydrate, which is
     * the ordinary way this happens: two `<button id="c">`, the new one at `0` and the server's
     * still there carrying `{"n":5}`.
     */
    class Counter extends Component {
      @state n = 0;
      @created({ env: "server" }) load() {
        this.n = 5;
      }
      render() {
        return <button id="c">{String(this.n)}</button>;
      }
    }

    class Panel extends Component {
      render() {
        return (
          <div id="p">
            {SIDE === "server" ? "10" : "9"}
            <Counter />
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Panel />);
    expect(container.querySelector("#c")!.textContent).toBe("5");
    const served = container.querySelector("#c")!;

    SIDE = "client";
    hydrateRoot(<Panel />, container);

    // One button, the server's own, with the state the server gave it.
    expect(container.querySelectorAll("#c")).toHaveLength(1);
    expect(container.querySelector("#c")).toBe(served);
    expect(container.innerHTML).toBe('<div id="p">9<button id="c">5</button></div>');
  });

  test("one text divergence inside a component reports one diagnostic", async () => {
    /**
     * The tail a text repair leaves is the second half of a divergence already reported. Counting it
     * as markup the server sent turned one fault into two messages, the second of which — "your
     * block is one node shorter" — describes nothing a reader can act on and sends them looking for
     * a structural difference that is not there.
     */
    class Status extends Component {
      render() {
        return SIDE === "server" ? "waiting" : "ready";
      }
    }

    class Shell extends Component {
      render() {
        return (
          <div id="d">
            <Status />
            <b id="after">after</b>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Shell />);

    SIDE = "client";
    hydrateRoot(<Shell />, container);

    expect(captured.codes).toEqual(["RMD007"]);
    expect(captured.messages[0]).toContain('rendered the text "ready"');
    expect(container.innerHTML).toBe('<div id="d">ready<b id="after">after</b></div>');
  });

  test("a longer run after a shorter one still takes its own slice", async () => {
    // The case the tail exists FOR, kept beside the one above so a fix for either cannot quietly
    // break the other: three children fused into one server node, the first of them divergent.
    class Greeting extends Component {
      render() {
        return (
          <div>
            <span id="g">
              {SIDE === "server" ? "Hi " : "Hello "}
              {SIDE}
              {"!"}
            </span>
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Greeting />);
    expect(container.querySelector("#g")!.textContent).toBe("Hi server!");

    SIDE = "client";
    hydrateRoot(<Greeting />, container);

    expect(container.querySelector("#g")!.textContent).toBe("Hello client!");
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

  /**
   * The mirror of the test above: the client renders MORE children than the server wrote.
   *
   * The walk runs out of server nodes in the middle of a component's run, so the cursor is standing
   * on that component's own CLOSING marker. A marker is structure rather than content — replacing it
   * deletes the answer to "where does this run end" — so the fresh node is inserted in front of it,
   * and the marker is consumed at close as usual.
   *
   * What that costs the reader is the diagnostic, which used to name the node it found by
   * `nodeName`: "the server sent `<#comment>`". The comment is the framework's own bookkeeping and
   * there is nothing for a reader to go and look at. The server's run for this component ended
   * there, so the honest answer is that it sent nothing.
   */
  test("a component whose block is SHORTER on the server keeps the siblings after it", async () => {
    class Inner extends Component {
      render() {
        return SIDE === "server" ? [<b>one</b>] : [<b>one</b>, <i>two</i>];
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
    SIDE = "client";
    hydrateRoot(<Page />, container);

    // Exactly a client render: the extra node inside the block, the sibling untouched, no markers.
    expect(container.innerHTML).toBe('<div><b>one</b><i>two</i><span id="after">after</span></div>');

    expect(captured.codes).toContain("RMD007");
    expect(captured.messages.join("\n")).toContain("rendered <i> but the server sent nothing");
    // The marker is ours, and naming it sends the reader after framework bookkeeping.
    expect(captured.messages.join("\n")).not.toContain("#comment");
  });

  /**
   * The same, from an EMPTY block — the case a host element could never produce.
   *
   * The server wrote a component that rendered `null`, so its block holds nothing at all between the
   * two markers. Every node the client renders is one the server did not send, and each is reported
   * as such rather than against the marker the cursor happens to be resting on.
   *
   * The sibling here is a plain element on purpose. A COMPONENT after the one that grew — where the
   * cost of a block ending in the wrong place is a lost state blob rather than a misplaced node — is
   * "an extra element at the END of a component's run keeps its sibling whole", further down.
   */
  test("a component the server rendered empty is filled in without touching its neighbours", async () => {
    class Inner extends Component {
      render() {
        return SIDE === "server" ? null : [<b>one</b>, <i>two</i>];
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
    // The server's block really is empty, which is what makes this different from the test above.
    expect(container.querySelectorAll("b, i").length).toBe(0);

    SIDE = "client";
    hydrateRoot(<Page />, container);

    expect(container.innerHTML).toBe('<div><b>one</b><i>two</i><span id="after">after</span></div>');
    expect(captured.messages.join("\n")).not.toContain("#comment");
  });

  /**
   * The other node type a reader is shown, and it had the same wart.
   *
   * `nodeName` gives `#text`, so an element rendered where the server sent words was reported as
   * "the server sent `<#text>`" — a node type where the page has content. `reportTextMismatch`
   * already names text by what it says, and this now matches it.
   */
  test("a text node in the way is named by what it says, not by its node type", async () => {
    class Page extends Component {
      render() {
        return <div>{SIDE === "server" ? "just text" : [<b>bold</b>]}</div>;
      }
    }

    const container = await serverHtmlInto(<Page />);
    SIDE = "client";
    hydrateRoot(<Page />, container);

    expect(captured.messages.join("\n")).toContain('rendered <b> but the server sent the text "just text"');
    expect(captured.messages.join("\n")).not.toContain("#text");
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

  test("an extra element at the END of a component's run keeps its sibling whole", async () => {
    /**
     * The mirror of the shorter-render case, and the worse of the two.
     *
     * The client renders one child MORE than the server did, and that child's cursor is the
     * component's OWN closing marker. Replacing it — which is what the element path did, while text
     * and components insert in front of it — leaves the block with no close of its own, so the walk
     * takes the ENCLOSING component's close for its own and removes everything in between: the next
     * sibling's opening marker, its nodes and its state blob. That sibling is then reached with no
     * marker at all, so a fresh instance is built and the server's state is thrown away.
     */
    const createdOn: string[] = [];

    class Inner extends Component {
      render() {
        return SIDE === "server" ? [<b>one</b>] : [<b>one</b>, <i>two</i>];
      }
    }

    class Sib extends Component {
      @state n = 0;
      @created({ env: "server" }) load() {
        this.n = 42;
      }
      @created({ env: "shared" }) note() {
        createdOn.push(SIDE);
      }
      render() {
        return <span id="sib">sib{String(this.n)}</span>;
      }
    }

    class Middle extends Component {
      render() {
        return [<Inner />, <Sib />];
      }
    }

    class Page extends Component {
      render() {
        return (
          <div>
            <Middle />
          </div>
        );
      }
    }

    const container = await serverHtmlInto(<Page />);
    expect(container.querySelector("#sib")!.textContent).toBe("sib42");
    createdOn.length = 0;

    SIDE = "client";
    hydrateRoot(<Page />, container);

    // The extra child is in, and the sibling after it is the one the server sent: same state, and
    // its `shared` @created did not run a second time.
    expect(container.innerHTML).toBe('<div><b>one</b><i>two</i><span id="sib">sib42</span></div>');
    expect(createdOn).toEqual([]);
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

    expect(container.querySelector("#shell")!.innerHTML).toBe('<span id="one">one</span><span id="two">two</span>');
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
