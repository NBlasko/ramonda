import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { state } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";
import { configureDev } from "../index";

/**
 * The `css` prop — the framework's half of a compiled style block.
 *
 * A block is written in real CSS beside the markup and compiled, before the build, into classes that
 * already exist in a stylesheet. **Nothing here parses anything**: by the time a value reaches the
 * framework it is the string that goes in the `class` attribute. See `packages/css/CONTRACT.md`.
 *
 * ## What this file used to be
 *
 * Half of it was about CUSTOM PROPERTIES. A `{expr}` hole compiled to `var(--r-…)` in the rule and
 * the value was set on the element, so the framework wrote properties, released the ones a changed
 * block no longer had, and refused a value that would parse back out of a server-rendered `style`
 * attribute as a second declaration. A runtime value in a declaration is refused now — see
 * `hole-not-allowed` in `@ramonda/css` — so there are none of those, and the `;` rule lives where
 * the hazard moved: `toStyle`, which is how a value reaches an element at all.
 *
 * What is left is the class, which has always travelled the ordinary attribute path.
 */

/** What the compiler emits at module scope: the classes, space separated. */
const flex: string = "r-disp-flex";
const bordered: string = "r-bl-4px_solid_red";

const styled = (container: Element) => container.querySelector("[class]") as HTMLElement;

describe("what a compiled block puts on the element", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("the generated class lands, and so does an author's own className", async () => {
    class Panel extends Component {
      render() {
        return (
          <div>
            <div className={`${flex} lead`}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    const element = styled(app.container);
    expect(element.classList.contains("r-disp-flex")).toBe(true);
    expect(element.classList.contains("lead")).toBe(true);
  });

  test("a block with no className of its own still gets the generated one", async () => {
    class Panel extends Component {
      render() {
        return (
          <div>
            <div className={flex}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    expect(styled(app.container).getAttribute("class")).toBe("r-disp-flex");
  });

  test("`css` never becomes an attribute of its own", async () => {
    class Panel extends Component {
      render() {
        return (
          <div>
            <div className={bordered}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    expect(styled(app.container).hasAttribute("css")).toBe(false);
  });
});

describe("what happens on the next render", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("a block that goes away takes its class with it", async () => {
    class Panel extends Component {
      @state on = true;
      render() {
        return (
          <div>
            <div className={this.on ? `${bordered} lead` : "lead"}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();
    expect(styled(app.container).classList.contains("r-bl-4px_solid_red")).toBe(true);

    app.instance.on = false;
    await app.settle();

    const element = styled(app.container);
    // The class the block generated is gone; the author's own is not.
    expect(element.classList.contains("r-bl-4px_solid_red")).toBe(false);
    expect(element.classList.contains("lead")).toBe(true);
  });

  test("a block replaced by a different one leaves nothing of the first behind", async () => {
    class Panel extends Component {
      @state first = true;
      render() {
        return (
          <div>
            <div className={this.first ? bordered : "r-c-blue"}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    app.instance.first = false;
    await app.settle();

    const element = styled(app.container);
    expect(element.classList.contains("r-bl-4px_solid_red")).toBe(false);
    expect(element.classList.contains("r-c-blue")).toBe(true);
  });
});

/**
 * **A block is a STRING now, so two renders that compose the same thing are the same value** — and
 * `RMD020`, which reports a prop whose identity changes for nothing, has nothing left to report.
 *
 * It used to be an object, freshly built per render, and the check was exempted for `css` the way it
 * is for `children`: the value was generated and a fresh identity meant nothing to anybody. That
 * exemption was the whole reason this describe exists, and the reason the hole was removed. What is
 * asserted here now is that the check is quiet because there is nothing to report, with a control
 * that proves it is still running.
 */
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

  test("a block is not reported, because two renders give the same string", async () => {
    class Panel extends Component {
      @state accent = "#10b981";
      render() {
        return (
          <div>
            <div className={bordered}>{this.accent}</div>
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
            <div className={bordered} onclick={() => this.accent}>
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
              <circle cx="5" cy="5" r="4" className={bordered} />
            </svg>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    const circle = app.container.querySelector("circle") as SVGElement;
    expect(circle.getAttribute("class")).toBe("r-bl-4px_solid_red");
  });
});

/**
 * A value holding SEVERAL classes, which is what every composed block is.
 *
 * A block is one class per DECLARATION, merged at the call site, so a value carries a list. The
 * order inside it decides nothing — a class attribute's order is not a cascade, the stylesheet's
 * order is — so these assert what must hold: every class arrives, and the author's own survives.
 */
describe("a value carrying several classes", () => {
  const composed: string = "r-disp-flex r-gap-8px r-c-red";

  test("every class reaches the element, and the author's own with them", async () => {
    class Panel extends Component {
      render() {
        return (
          <div>
            <div className={`${composed} lead`}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    expect([...styled(app.container).classList].sort()).toEqual(["lead", "r-c-red", "r-disp-flex", "r-gap-8px"]);
  });

  test("and swapping it for a different set leaves none of the first behind", async () => {
    class Panel extends Component {
      @state first = true;
      render() {
        return (
          <div>
            <div className={`${this.first ? composed : "r-o-.5"} lead`}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    app.instance.first = false;
    await app.settle();

    expect([...styled(app.container).classList].sort()).toEqual(["lead", "r-o-.5"]);
  });
});
