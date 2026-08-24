import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, state } from "../index";

/**
 * An object style is written as CSS text, so every property name has to be in
 * the dashed form CSS parses. camelCase was emitted verbatim, and the browser
 * drops declarations it cannot read one by one, silently — measured
 * `{ gridTemplateColumns, backgroundColor, color }` landing as
 * `style="color: blue;"`, with half the style gone and nothing reported.
 */

class Styled extends Component {
  @state columns = 2;
  @state label = "x";
  render() {
    return (
      <div>
        <div
          style={{
            gridTemplateColumns: `repeat(${this.columns}, 1fr)`,
            backgroundColor: "red",
            color: "blue",
          }}
        >
          {this.label}
        </div>
      </div>
    );
  }
}

/**
 * The element the style was written on.
 *
 * It used to be a `<div>` under the component's host, found by the host's DEV marker. A component
 * has no host, so the styled element is simply the one the render returns.
 */
const styled = (c: Element) => c.querySelector("[style]") as HTMLElement;

/** Counts writes to style.cssText on one element. */
function countStyleWrites(el: HTMLElement) {
  let writes = 0;
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el.style), "cssText")!;
  Object.defineProperty(el.style, "cssText", {
    get: descriptor.get!.bind(el.style),
    set: (value: string) => {
      writes++;
      descriptor.set!.call(el.style, value);
    },
    configurable: true,
  });
  return () => writes;
}

describe("object style", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("camelCase property names survive as real CSS", async () => {
    const app = await getDOM<Styled>(<Styled />);
    await app.settle();

    const el = styled(app.container);
    expect(el.style.gridTemplateColumns).toBe("repeat(2, 1fr)");
    expect(el.style.backgroundColor).toBe("red");
    expect(el.style.color).toBe("blue");
  });

  test("a render that does not change the style writes nothing", async () => {
    const app = await getDOM<Styled>(<Styled />);
    await app.settle();

    const writes = countStyleWrites(styled(app.container));

    // Re-render for an unrelated reason. The style string is identical, and
    // comparing it against the browser-normalized cssText used to say otherwise,
    // so it was re-written every single render.
    app.instance.label = "y";
    await app.settle();
    expect(writes()).toBe(0);

    app.instance.columns = 3;
    await app.settle();
    expect(writes()).toBe(1);
    expect(styled(app.container).style.gridTemplateColumns).toBe("repeat(3, 1fr)");
  });

  test("a host without a style does not get an empty style attribute", async () => {
    const app = await getDOM<Styled>(<Styled />);
    await app.settle();

    // No style asked for, so no attribute written — on the component's own element, which is the
    // only element there is.
    const element = app.container.querySelector("div") as HTMLElement;
    expect(element.hasAttribute("style")).toBe(false);
  });

  test("custom properties keep their name, and empty values are dropped", async () => {
    class Custom extends Component {
      render() {
        return (
          <div>
            <div style={{ "--brand": "#f05", marginTop: "4px", color: "" }}>x</div>
          </div>
        );
      }
    }

    const app = await getDOM<Custom>(<Custom />);
    await app.settle();

    const el = styled(app.container);
    expect(el.style.getPropertyValue("--brand")).toBe("#f05");
    expect(el.style.marginTop).toBe("4px");
    expect(el.style.color).toBe("");
  });
});
