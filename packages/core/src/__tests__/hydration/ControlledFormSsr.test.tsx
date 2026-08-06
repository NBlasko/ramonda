import { describe, test, expect } from "vitest";
import { state, Host } from "../../base/decorators";
import { Component } from "../../base/Component";
import { renderToString } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";

/**
 * `value` and `checked` on the SERVER, and through hydration.
 *
 * The client fix for controlled form values consults the live DOM PROPERTY as
 * well as the attribute, and writes `checked` as a property. A server render has
 * no live control — it builds elements in linkedom to serialize them — so the
 * question this file answers is whether the markup still comes out right there,
 * and whether a hydrated page reads it back without patching what the server
 * wrote.
 *
 * Worth its own file because the client tests cannot see it: they run against
 * jsdom with a real property setter behind them, and the server's element may
 * have no such setter at all.
 */
describe("controlled form values on the server", () => {
  test("value and checked are serialized", async () => {
    @Host("form")
    class Editor extends Component {
      @state text = "hello";
      @state agreed = true;
      @state subscribed = false;

      render() {
        return (
          <div>
            <input id="t" value={this.text} />
            <input id="a" type="checkbox" checked={this.agreed} />
            <input id="s" type="checkbox" checked={this.subscribed} />
          </div>
        );
      }
    }

    const html = await renderToString(<Editor />);

    expect(html).toContain('value="hello"');
    // Present means checked; absent means not. The false one must not appear.
    expect(html).toMatch(/id="a"[^>]*checked/);
    expect(html).not.toMatch(/id="s"[^>]*checked/);
  });

  test("an empty value still reaches the markup", async () => {
    @Host("form")
    class Editor extends Component {
      @state text = "";
      render() {
        return <input id="t" value={this.text} />;
      }
    }

    const html = await renderToString(<Editor />);

    // The property's own default is "" too, so a comparison that consulted only
    // the live property would agree with itself and write nothing — leaving an
    // element that looks right and serializes without the attribute.
    expect(html).toContain('value=""');
  });

  test("hydration adopts the server's control without changing it", async () => {
    @Host("form")
    class Editor extends Component {
      @state text = "hello";
      @state agreed = true;

      render() {
        return (
          <div>
            <input id="t" value={this.text} />
            <input id="a" type="checkbox" checked={this.agreed} />
          </div>
        );
      }
    }

    const html = await renderToString(<Editor />);

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    const before = container.querySelector("#t");
    hydrateRoot(<Editor />, container);

    const text = container.querySelector("#t") as HTMLInputElement;
    const box = container.querySelector("#a") as HTMLInputElement;

    // Adopted, not rebuilt.
    expect(text).toBe(before);
    // And the live properties now say what the model says, which is what makes
    // the page controlled from the first interaction rather than the first
    // re-render.
    expect(text.value).toBe("hello");
    expect(box.checked).toBe(true);

    container.remove();
  });
});
