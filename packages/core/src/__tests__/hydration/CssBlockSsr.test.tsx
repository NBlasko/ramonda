import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { Component } from "../../base/Component";
import { hydrateRoot } from "../../hydration/hydrate";
import { renderToString } from "../../hydration/ssr";
import { resetDiagnostics } from "../../debug/diagnostics";
import type { CssBlockValue } from "../../types/cssBlock";

/**
 * A compiled style block across the server/client boundary.
 *
 * The claim the design rests on is that **nothing needs a separate channel**: the values are derived
 * from state during the render, the server writes them into the markup, and the client re-derives
 * them from the same state. No payload beside the HTML, no registry, nothing to look up — which is
 * the whole benefit of the holes being values rather than rules.
 *
 * These are the measurements, not the argument.
 */

function block(className: string, properties: string[] = []): (...values: (string | number)[]) => CssBlockValue {
  return (...values) => ({ className, properties, values });
}

const bordered = block("r-8e271c6c1f3a4b02", ["--r-8e271c6c1f3a4b02-0"]);

function captureDiagnostics() {
  const all: string[] = [];
  const handler = (event: Event) => {
    all.push((event as CustomEvent).detail.message as string);
  };
  window.addEventListener("ramonda:dev-log", handler);
  return {
    coded: () => all.filter((message) => /^\[RMD\d+\]/.test(message)),
    stop: () => window.removeEventListener("ramonda:dev-log", handler),
  };
}

/** One component whose block carries whatever value it is given — or no block at all. */
function panelWith(value: string | undefined) {
  return class Panel extends Component {
    render() {
      return (
        <div>
          <div className="lead" css={value === undefined ? undefined : bordered(value)}>
            x
          </div>
        </div>
      );
    }
  };
}

async function serverThenClient(onServer: string | undefined, onClient: string | undefined) {
  const Server = panelWith(onServer);
  const Client = panelWith(onClient);

  const html = await renderToString(<Server />);
  const container = document.createElement("div");
  document.body.appendChild(container);
  // Through markup and back: the parse is what applies the DOM's own rules.
  container.innerHTML = html;

  hydrateRoot(<Client />, container);
  await Promise.resolve();

  return { html, element: container.querySelector(".lead") as HTMLElement };
}

describe("a block on the server", () => {
  beforeEach(() => {
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("its values travel in the markup, with nothing beside them", async () => {
    const Panel = panelWith("#10b981");
    const html = await renderToString(<Panel />);

    expect(html).toContain("r-8e271c6c1f3a4b02");
    expect(html).toContain("--r-8e271c6c1f3a4b02-0");
    expect(html).toContain("#10b981");
  });
});

describe("the four directions", () => {
  let captured: ReturnType<typeof captureDiagnostics>;

  beforeEach(() => {
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation(() => {});
    captured = captureDiagnostics();
  });

  afterEach(() => {
    captured.stop();
    vi.restoreAllMocks();
  });

  test("the same value on both sides is silent, and the DOM is right", async () => {
    const { element } = await serverThenClient("#10b981", "#10b981");

    expect(captured.coded()).toEqual([]);
    expect(element.style.getPropertyValue("--r-8e271c6c1f3a4b02-0")).toBe("#10b981");
    expect(element.classList.contains("r-8e271c6c1f3a4b02")).toBe(true);
  });

  /**
   * **Measured, and it supersedes an earlier reading.** The same divergence written as an object
   * style — `style={{ "--r0": … }}` — was reported as RMD007, because the value was part of an
   * attribute the comparator reads. A compiled block is not: the class is compared like any other
   * class, and the values are applied with `setProperty` after the attribute pass, so nothing
   * compares them.
   *
   * Silent, and the client's value wins. That is the better half of the two failing directions the
   * design measured: the one that was reported was also the one the framework did NOT repair.
   */
  test("a different value is silent, and the client's wins", async () => {
    const { element } = await serverThenClient("#10b981", "#ff0000");

    expect(captured.coded()).toEqual([]);
    expect(element.style.getPropertyValue("--r-8e271c6c1f3a4b02-0")).toBe("#ff0000");
  });

  test("a block only on the server is taken off by the client", async () => {
    const { element } = await serverThenClient("#10b981", undefined);

    // The class disagrees, which is a divergence the framework already reports on `class`.
    expect(captured.coded().join("\n")).toContain("RMD007");
    expect(element.classList.contains("r-8e271c6c1f3a4b02")).toBe(false);
    expect(element.classList.contains("lead")).toBe(true);
  });

  test("a block only on the client is put on by it", async () => {
    const { element } = await serverThenClient(undefined, "#10b981");

    expect(element.classList.contains("r-8e271c6c1f3a4b02")).toBe(true);
    expect(element.style.getPropertyValue("--r-8e271c6c1f3a4b02-0")).toBe("#10b981");
  });
});

describe("what the markup does with a value the expression produced", () => {
  beforeEach(() => {
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  /**
   * The client-side guarantee is `setProperty`, which writes one declaration whatever it is handed.
   * A server render does not end at the DOM — it is serialized to HTML and PARSED again, and a parse
   * applies the CSS grammar to whatever text the serializer produced.
   *
   * **This test found a real hole rather than confirming there was none.** Before the check in
   * `core/cssBlock.ts`, the same value that is inert on the client came back through markup as
   * `position: fixed; width: 100vw; z-index: 9999` — real, applied declarations. The client
   * guarantee never touches a server-rendered page, so the framework refuses the value instead of
   * relying on the DOM to.
   */
  test("a hostile value, measured through markup and back", async () => {
    const hostile = "red; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999";

    const Panel = panelWith(hostile);
    const html = await renderToString(<Panel />);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    const element = container.querySelector(".lead") as HTMLElement;
    expect({
      position: element.style.position,
      width: element.style.width,
      zIndex: element.style.zIndex,
    }).toEqual({ position: "", width: "", zIndex: "" });
  });
});

/**
 * A hole's value becomes ATTRIBUTE TEXT on the server, and a `;` is not the only character that
 * matters there.
 *
 * The semicolon rule exists because the CSS parse turns one into a second declaration. This asks the
 * other question about the same text: whether the value can leave the attribute it was written in.
 * A value is whatever an expression evaluated to and an expression can read a record, so a quote in
 * it is not a hypothetical — and a quote that reached the markup unescaped would end `style="` and
 * start an attribute of the attacker's choosing, on an element the author wrote.
 *
 * Measured, and the serializer holds: the quote comes back as `&quot;`. `<` and `>` are written
 * literally, which is correct — inside a quoted attribute value the HTML parser reads them as text,
 * so `</style><script>` there is inert. This is here so that stays true.
 */
describe("a value carrying characters that mean something in markup", () => {
  test("a quote is escaped, so it cannot open an attribute of its own", async () => {
    const Panel = panelWith(`red" onmouseover="alert(1)`);
    const html = await renderToString(<Panel />);

    expect(html).toContain("&quot; onmouseover=&quot;");
    expect(html).not.toContain(`onmouseover="alert`);
  });

  test("and the element that comes back out of a parse has no attribute it was not given", async () => {
    const Panel = panelWith(`red" onmouseover="alert(1)`);
    const container = document.createElement("div");
    container.innerHTML = await renderToString(<Panel />);

    const styled = container.querySelector(".lead") as HTMLElement;
    expect(styled.getAttribute("onmouseover")).toBeNull();
    expect(styled.getAttributeNames().sort()).toEqual(["class", "style"]);
  });

  /** Literal, and inert: an attribute value is text, so nothing here opens an element. */
  test("angle brackets stay text inside the attribute", async () => {
    const Panel = panelWith(`red</style><script>alert(1)</script>`);
    const container = document.createElement("div");
    container.innerHTML = await renderToString(<Panel />);

    expect(container.querySelector("script")).toBeNull();
    expect(
      (container.querySelector(".lead") as HTMLElement).style.getPropertyValue("--r-8e271c6c1f3a4b02-0"),
    ).toContain("script");
  });
});

/**
 * The `;` rule applied to a value that is not a string yet.
 *
 * `holdsOneDeclaration` reads text, and a value only becomes text when it is written — so asking
 * `typeof value === "string"` first is asking about the wrong thing. Every other kind of value went
 * to `String(value)` unexamined, and `toString` is a method an object can have.
 *
 * **Measured, and it was a real hole rather than a hypothetical**: the same value that is refused as
 * a string came through markup as `position: fixed; width: 100vw; z-index: 9999` — applied, on the
 * page — when it arrived as `{ toString: () => … }`. The type refuses everything but a string and a
 * number, so it takes unchecked JavaScript to get here; `isCompiledBlock` exists because unchecked
 * JavaScript does get here.
 */
describe("a value that is not a string", () => {
  beforeEach(() => {
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const HOSTILE = "red; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999";

  test("an object whose text is a second declaration is refused too", async () => {
    const Panel = panelWith({ toString: () => HOSTILE } as unknown as string);
    const container = document.createElement("div");
    container.innerHTML = await renderToString(<Panel />);

    const element = container.querySelector(".lead") as HTMLElement;
    expect({ position: element.style.position, width: element.style.width, zIndex: element.style.zIndex }).toEqual({
      position: "",
      width: "",
      zIndex: "",
    });
  });

  /** An array joins with `,`, so its own text can carry a `;` from any one of its members. */
  test("an array carrying one in a member is refused", async () => {
    const Panel = panelWith(["red", " position: fixed; width: 100vw"] as unknown as string);
    const container = document.createElement("div");
    container.innerHTML = await renderToString(<Panel />);

    expect((container.querySelector(".lead") as HTMLElement).style.width).toBe("");
  });

  /**
   * And the kinds that carry no `;` are refused as well, which is the other half of the same rule: a
   * custom property holds text, so `String(value)` always produces SOMETHING, and `true`,
   * `[object Object]` and `() => 1` are all text no property can parse. Writing them leaves the
   * declaration to fall back in silence; refusing them says so.
   */
  test("the kinds a custom property cannot hold are not written", async () => {
    for (const value of [true, {}, () => 1, Number.NaN]) {
      const Panel = panelWith(value as unknown as string);
      const html = await renderToString(<Panel />);
      expect(html).not.toContain("--r-8e271c6c1f3a4b02-0:");
    }
  });
});
