import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { Component } from "../../base/Component";
import { hydrateRoot } from "../../hydration/hydrate";
import { renderToString } from "../../hydration/ssr";
import { resetDiagnostics } from "../../debug/diagnostics";

/**
 * A compiled style block across the server/client boundary.
 *
 * **Nothing needs a separate channel**, and there is less to say about that than there used to be: a
 * block is the class string it compiled to, the server writes it into the markup, and the client
 * derives the same string from the same state. No payload beside the HTML, no registry, nothing to
 * look up.
 *
 * ## What this file used to measure
 *
 * The VALUES a `{expr}` hole carried, which travelled in the `style` attribute and were parsed back
 * out of it by the browser. That is where a hostile value became real declarations — measured,
 * `red; position: fixed; width: 100vw` came out of the round trip applied — and where a value
 * missing on one side of hydration went unreported or unrepaired.
 *
 * A runtime value in a declaration is refused now, so a block carries none. The `;` rule moved with
 * the hazard to `toStyle`, which is how a value reaches an element at all, and is measured there.
 * What is left here is the class, which the framework compares like any other class.
 */

/** Every coded diagnostic the framework raised, read off the event it raises them on. */
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

function panelWith(css: string | undefined) {
  return class Panel extends Component {
    render() {
      return (
        <div>
          <div className={css === undefined ? "lead" : `${css} lead`}>x</div>
        </div>
      );
    }
  };
}

const BORDERED = "r-bl-4px_solid_red";

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

  test("its classes travel in the markup, beside the author's own", async () => {
    const Panel = panelWith(`${BORDERED} r-c-red`);
    const html = await renderToString(<Panel />);

    expect(html).toContain(BORDERED);
    expect(html).toContain("r-c-red");
    expect(html).toContain("lead");
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

  test("the same block on both sides is silent, and the DOM is right", async () => {
    const { element } = await serverThenClient(BORDERED, BORDERED);

    expect(captured.coded()).toEqual([]);
    expect(element.classList.contains(BORDERED)).toBe(true);
  });

  /**
   * **A different block IS reported now, and that is a gain rather than a change.**
   *
   * The values used to be applied with `setProperty` after the attribute pass, so nothing compared
   * them and a divergence was silent — the better half of two bad directions, since the one that was
   * reported was also the one the framework did not repair. The class is compared like any other
   * class, so a block that differs across the boundary is `RMD007` and is repaired.
   */
  test("a different block is reported on `class`, and the client's wins", async () => {
    const { element } = await serverThenClient(BORDERED, "r-c-blue");

    expect(captured.coded().join("\n")).toContain("RMD007");
    expect(element.classList.contains("r-c-blue")).toBe(true);
    expect(element.classList.contains(BORDERED)).toBe(false);
  });

  test("a block only on the server is taken off by the client", async () => {
    const { element } = await serverThenClient(BORDERED, undefined);

    // The class disagrees, which is a divergence the framework already reports on `class`.
    expect(captured.coded().join("\n")).toContain("RMD007");
    expect(element.classList.contains(BORDERED)).toBe(false);
    expect(element.classList.contains("lead")).toBe(true);
  });

  test("a block only on the client is put on by it", async () => {
    const { element } = await serverThenClient(undefined, BORDERED);

    expect(element.classList.contains(BORDERED)).toBe(true);
  });
});

/**
 * A class name holds characters CSS has to escape in a SELECTOR — `#`, `(`, `.` — and a class
 * ATTRIBUTE takes them as they are. So the one thing the markup owes is that a name comes back out
 * of a parse as the name that went in.
 */
describe("a class name carrying characters a selector would escape", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test.each([
    ["a hash, which a colour is", "r-c-#10b981"],
    ["a call, which a `var()` read is", "r-c-var(--r-abc)"],
    ["a dot, which a context joins with", "r-:hover.c-red"],
  ])("%s survives the round trip", async (_what, className) => {
    const { element } = await serverThenClient(className, className);

    expect(element.classList.contains(className)).toBe(true);
  });

  test("and the element that comes back out of a parse has no attribute it was not given", async () => {
    const { element } = await serverThenClient("r-c-#10b981", "r-c-#10b981");

    expect([...element.attributes].map((one) => one.name).sort()).toEqual(["class"]);
  });
});
