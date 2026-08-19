import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";

/**
 * The four ways a picture or a frame may be named, asserted as behaviour rather than only as types.
 *
 * The requirement lives in `global.ts`, so most of it is proved by the fact that this file compiles
 * at all — every shape below is one `tsc` had to accept, and the ones it must refuse are in
 * `NamedImageTypes.refused.tsx` beside it, each under its own `@ts-expect-error`.
 *
 * What is asserted HERE is the half a type cannot state: that each spelling survives to the
 * document. `alt=""` in particular has to arrive as an empty attribute rather than be dropped —
 * it is the documented way to say "decoration, skip me", and a framework that swallowed it would
 * turn a decision into an omission.
 */
describe("a named image", () => {
  test('every spelling reaches the document, `alt=""` included', async () => {
    class Gallery extends Component {
      render() {
        return (
          <div>
            <img src="/a.png" alt="a cat" />
            <img src="/b.png" alt="" />
            <img src="/c.png" aria-label="a dog" />
            <img src="/d.png" aria-labelledby="cap" />
            <img src="/e.png" title="a bird" />
            <iframe src="/x" title="A map" />
            <area href="/x" alt="Region" />
          </div>
        );
      }
    }

    const { container } = await getDOM(<Gallery />);
    const images = [...container.querySelectorAll("img")];

    expect(images[0]?.getAttribute("alt")).toBe("a cat");
    // Present and empty, not absent: the decision has to survive.
    expect(images[1]?.hasAttribute("alt")).toBe(true);
    expect(images[1]?.getAttribute("alt")).toBe("");
    expect(images[2]?.getAttribute("aria-label")).toBe("a dog");
    expect(images[3]?.getAttribute("aria-labelledby")).toBe("cap");
    expect(images[4]?.getAttribute("title")).toBe("a bird");
    expect(container.querySelector("iframe")?.getAttribute("title")).toBe("A map");
    expect(container.querySelector("area")?.getAttribute("alt")).toBe("Region");
  });
});
