import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { state } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";
import { configureDev } from "../index";
import type { CssBlockValue } from "../types/cssBlock";

/**
 * The `css` prop — the framework's half of a compiled style block.
 *
 * A block is written in real CSS beside the markup and compiled, before the build, into a class that
 * already exists in a stylesheet plus one custom property per carried expression. **Nothing here
 * parses anything**: by the time a value reaches the framework it is a class name, a list of custom
 * property names, and a list of values. See `packages/css/CONTRACT.md`.
 *
 * The values are built by hand below rather than imported. `@ramonda/css` may not import the
 * framework and the framework may not depend on it, so the shape is declared on both sides and
 * `scripts/check-css-contract.mjs` is what keeps the two declarations from drifting.
 */

/** What the compiler emits at module scope, written out. */
function block(className: string, properties: string[] = []): (...values: (string | number)[]) => CssBlockValue {
  return (...values) => ({ className, properties, values });
}

const bordered = block("r-8e271c6c1f3a4b02", ["--r-8e271c6c1f3a4b02-0"]);
const flex: CssBlockValue = { className: "r-1111111111111111", properties: [], values: [] };

const styled = (container: Element) => container.querySelector("[class]") as HTMLElement;

describe("what a compiled block puts on the element", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("the generated class lands, and so does an author's own className", async () => {
    class Panel extends Component {
      render() {
        return (
          <div>
            <div className="lead" css={flex}>
              x
            </div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    const element = styled(app.container);
    expect(element.classList.contains("r-1111111111111111")).toBe(true);
    expect(element.classList.contains("lead")).toBe(true);
  });

  test("a block with no className of its own still gets the generated one", async () => {
    class Panel extends Component {
      render() {
        return (
          <div>
            <div css={flex}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    expect(styled(app.container).getAttribute("class")).toBe("r-1111111111111111");
  });

  test("each hole becomes a custom property with its value", async () => {
    class Panel extends Component {
      render() {
        return (
          <div>
            <div css={bordered("4px solid #10b981")}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    expect(styled(app.container).style.getPropertyValue("--r-8e271c6c1f3a4b02-0")).toBe("4px solid #10b981");
  });

  test("a number arrives as text, because a custom property holds text", async () => {
    class Panel extends Component {
      render() {
        return (
          <div>
            <div css={bordered(24)}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    expect(styled(app.container).style.getPropertyValue("--r-8e271c6c1f3a4b02-0")).toBe("24");
  });

  test("`css` never becomes an attribute of its own", async () => {
    class Panel extends Component {
      render() {
        return (
          <div>
            <div css={bordered("red")}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    expect(styled(app.container).hasAttribute("css")).toBe(false);
  });
});

describe("a value the expression produced, not the author", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  /**
   * The reason the values are applied with `setProperty` rather than written into a style string.
   *
   * A hole's value is whatever the expression evaluated to, and an expression can read a database —
   * so "the author wrote it" is not a defence. Measured in this harness, both ways, with the same
   * hostile value:
   *
   *     style.cssText = `--r-0: ${value}`   ->  position: fixed, width: 100vw — real, applied
   *     style.setProperty("--r-0", value)   ->  position: "", width: "" — nothing else exists
   *
   * A full-viewport fixed overlay out of a colour that came from a record. `setProperty` cannot
   * create a second declaration whatever it is handed, so this direction holds even for a value the
   * framework let through — which is what it asserts. The test below covers the other half.
   */
  test("a hostile value cannot become a second declaration", async () => {
    const hostile = "red; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999";

    class Panel extends Component {
      render() {
        return (
          <div>
            <div css={bordered(hostile)}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    const element = styled(app.container);
    expect(element.style.position).toBe("");
    expect(element.style.width).toBe("");
    expect(element.style.zIndex).toBe("");
  });

  /**
   * And the property is not written either, which is the half `setProperty` does NOT give.
   *
   * A server render is serialized to HTML and parsed back, and the parse turns the same text into
   * real declarations — measured, see `hydration/CssBlockSsr.test.tsx`. So the value is refused here
   * rather than left to a DOM that only refuses it on one of the two paths, and the declaration is
   * simply dropped: a missing border beats an overlay somebody's record asked for.
   */
  test("and the property is not written at all", async () => {
    class Panel extends Component {
      render() {
        return (
          <div>
            <div css={bordered("red; position: fixed")}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    expect(styled(app.container).style.getPropertyValue("--r-8e271c6c1f3a4b02-0")).toBe("");
  });

  test("a value that changes from hostile to ordinary is written", async () => {
    class Panel extends Component {
      @state accent = "red; position: fixed";
      render() {
        return (
          <div>
            <div css={bordered(this.accent)}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();
    expect(styled(app.container).style.getPropertyValue("--r-8e271c6c1f3a4b02-0")).toBe("");

    app.instance.accent = "#10b981";
    await app.settle();
    expect(styled(app.container).style.getPropertyValue("--r-8e271c6c1f3a4b02-0")).toBe("#10b981");
  });
});

describe("what happens on the next render", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("a changed hole updates its property", async () => {
    class Panel extends Component {
      @state accent = "#10b981";
      render() {
        return (
          <div>
            <div css={bordered(this.accent)}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    app.instance.accent = "#ff0000";
    await app.settle();

    expect(styled(app.container).style.getPropertyValue("--r-8e271c6c1f3a4b02-0")).toBe("#ff0000");
  });

  test("a block that goes away takes its class and its properties with it", async () => {
    class Panel extends Component {
      @state on = true;
      render() {
        return (
          <div>
            <div className="lead" css={this.on ? bordered("red") : undefined}>
              x
            </div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();
    expect(styled(app.container).style.getPropertyValue("--r-8e271c6c1f3a4b02-0")).toBe("red");

    app.instance.on = false;
    await app.settle();

    const element = styled(app.container);
    // The class the block generated is gone; the author's own is not.
    expect(element.classList.contains("r-8e271c6c1f3a4b02")).toBe(false);
    expect(element.classList.contains("lead")).toBe(true);
    // And the property with it, or the element keeps a value nothing sets any more.
    expect(element.style.getPropertyValue("--r-8e271c6c1f3a4b02-0")).toBe("");
  });

  test("a block replaced by a different one leaves nothing of the first behind", async () => {
    const other = block("r-2222222222222222", ["--r-2222222222222222-0"]);

    class Panel extends Component {
      @state first = true;
      render() {
        return (
          <div>
            <div css={this.first ? bordered("red") : other("blue")}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    app.instance.first = false;
    await app.settle();

    const element = styled(app.container);
    expect(element.style.getPropertyValue("--r-8e271c6c1f3a4b02-0")).toBe("");
    expect(element.style.getPropertyValue("--r-2222222222222222-0")).toBe("blue");
    expect(element.classList.contains("r-8e271c6c1f3a4b02")).toBe(false);
    expect(element.classList.contains("r-2222222222222222")).toBe(true);
  });
});

describe("the double-render check and the value the compiler generated", () => {
  let logs: string[] = [];

  beforeEach(() => {
    configureDev({ strictRender: true });
    resetDiagnostics();
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    configureDev({ strictRender: false });
    vi.restoreAllMocks();
  });

  /**
   * A `css` value with holes is a fresh object on every render — that is what a per-element value
   * IS — so RMD020 sees exactly what it is built to report and would be right about every element
   * carrying a block. It is exempt for the same reason `children` is: the value is generated, and a
   * fresh identity for it means nothing to anybody.
   */
  test("a block with holes is not reported", async () => {
    class Panel extends Component {
      @state accent = "#10b981";
      render() {
        return (
          <div>
            <div css={bordered(this.accent)}>x</div>
          </div>
        );
      }
    }

    await getDOM<Panel>(<Panel />);

    expect(logs.join("\n")).not.toContain("RMD020");
  });

  /** The control: silence proves nothing unless the same render can still be reported. */
  test("and the check is still running — an inline handler beside it is", async () => {
    class Panel extends Component {
      @state accent = "#10b981";
      render() {
        return (
          <div>
            <div css={bordered(this.accent)} onclick={() => this.accent}>
              x
            </div>
          </div>
        );
      }
    }

    await getDOM<Panel>(<Panel />);

    const reported = logs.join("\n");
    expect(reported).toContain("RMD020");
    expect(reported).toContain("onclick");
    expect(reported).not.toContain("css");
  });
});

describe("on an SVG element", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  /**
   * `className` on an SVG element is a read-only `SVGAnimatedString`, so the class has to be written
   * as the attribute. The block goes through the same path as an author's `className`, which is what
   * makes this true without a second rule.
   */
  test("the generated class is written as an attribute", async () => {
    class Panel extends Component {
      render() {
        return (
          <div>
            <svg viewBox="0 0 10 10">
              <circle cx="5" cy="5" r="4" css={bordered("red")} />
            </svg>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    const circle = app.container.querySelector("circle") as SVGElement;
    expect(circle.getAttribute("class")).toBe("r-8e271c6c1f3a4b02");
    expect(circle.style.getPropertyValue("--r-8e271c6c1f3a4b02-0")).toBe("red");
  });
});
