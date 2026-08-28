import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../index";

/**
 * SVG attribute names, at the type level and at runtime.
 *
 * Ramonda writes an SVG attribute name **verbatim** — `setAttributeNS(null,
 * name, value)`, no translation — because the JSX is meant to be the DOM. So the
 * name to write is the one SVG itself defines: `stroke-width` is dashed,
 * `viewBox` and `gradientUnits` are camelCase. `strokeWidth` is not an SVG
 * attribute name at all: the types reject it, and it would not work at runtime
 * either, since SVG attribute names are case-sensitive.
 *
 * This file is checked twice over. **Compiling it is half the test** — every
 * attribute below once failed to typecheck, because each is also a DOM property
 * typed `SVGAnimatedLength` / `SVGAnimatedEnumeration`, and a string does not
 * assign to those. If `SVGArgs` regresses, `tsc` fails on this file before a
 * single assertion runs. The assertions cover the other half: that the name
 * reaches the DOM unchanged.
 */
describe("SVG attributes", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("dashed, lowercase and camelCase names all reach the DOM verbatim", async () => {
    class Icon extends Component {
      render() {
        return (
          <div>
            <svg viewBox="0 0 24 24" width="24" height="24">
              <circle cx="12" cy={12} r="10" fill="none" stroke-width="2" />
              <linearGradient gradientUnits="userSpaceOnUse" gradientTransform="rotate(90)" />
              <marker markerWidth={6} markerHeight={6} refX={3} refY={3} />
            </svg>
          </div>
        );
      }
    }

    const app = await getDOM<Icon>(<Icon />);
    await app.settle();

    const svg = app.container.querySelector("svg")!;
    // Case is preserved: HTML would have lowercased this, SVG must not.
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");

    const circle = app.container.querySelector("circle")!;
    expect(circle.getAttribute("cx")).toBe("12");
    // A number prop arrives as a number and is stringified on the way out.
    expect(circle.getAttribute("cy")).toBe("12");
    expect(circle.getAttribute("stroke-width")).toBe("2");

    const gradient = app.container.querySelector("linearGradient")!;
    expect(gradient.getAttribute("gradientUnits")).toBe("userSpaceOnUse");
    expect(gradient.getAttribute("gradientTransform")).toBe("rotate(90)");

    const marker = app.container.querySelector("marker")!;
    expect(marker.getAttribute("markerWidth")).toBe("6");
    expect(marker.getAttribute("refX")).toBe("3");
  });

  test("camelCase names are not lowercased the way HTML would", async () => {
    class Icon extends Component {
      render() {
        return (
          <div>
            <svg viewBox="0 0 8 8">
              <clipPath clipPathUnits="userSpaceOnUse" />
            </svg>
          </div>
        );
      }
    }

    const app = await getDOM<Icon>(<Icon />);
    await app.settle();

    const clip = app.container.querySelector("clipPath")!;
    // The distinction this whole design rests on: in SVG these are two
    // different attributes, and only the exact one has any effect.
    expect(clip.getAttribute("clipPathUnits")).toBe("userSpaceOnUse");
    expect(clip.getAttribute("clippathunits")).toBeNull();
  });

  test("className and style still work on an SVG element", async () => {
    class Icon extends Component {
      render() {
        return (
          <div>
            <svg viewBox="0 0 8 8">
              {/* `className` is an SVGAnimatedString on the DOM interface, so it
                  needs the same treatment as the camelCase attributes above. */}
              <g className="layer" style="opacity: 0.5" />
            </svg>
          </div>
        );
      }
    }

    const app = await getDOM<Icon>(<Icon />);
    await app.settle();

    const group = app.container.querySelector("g")!;
    expect(group.getAttribute("class")).toBe("layer");
    expect(group.getAttribute("style")).toContain("opacity");
  });
});
