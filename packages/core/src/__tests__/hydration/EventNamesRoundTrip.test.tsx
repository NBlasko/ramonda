import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { Component } from "../../base/Component";
import { Host, state } from "../../base/decorators";
import { hydrateRoot } from "../../hydration/hydrate";
import { renderToString } from "../../hydration/ssr";
import { resetDiagnostics } from "../../debug/diagnostics";

/**
 * An event name through the whole round trip: rendered on the server, parsed back, hydrated.
 *
 * A listener is not an attribute, so none of these may appear in the markup — and the `on:` form is
 * the one worth pinning, because it is the only attribute name here that a careless
 * `startsWith("on")` could let through to `setAttribute`. What would ship then is
 * `on:my-event="function () { … }"` in the page's HTML.
 *
 * The other half is that hydration attaches them from the adopted DOM, and reports no mismatch
 * while doing it: the two sides render the same markup, so `RMD007` must stay quiet.
 */
let codes: string[] = [];

beforeEach(() => {
  codes = [];
  resetDiagnostics();
  vi.spyOn(console, "log").mockImplementation(() => {});
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => codes.push(record.code);
});

afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
  vi.restoreAllMocks();
});

@Host("div")
class Counter extends Component {
  @state n = 0;
  render() {
    return (
      <button id="b" onclick={() => this.n++} on:my-event={() => this.n++} onfocusin={() => {}}>
        {this.n}
      </button>
    );
  }
}

describe("event names through a server render and back", () => {
  test("no spelling reaches the markup as an attribute", async () => {
    const html = await renderToString(<Counter />);

    expect(html).toContain('<button id="b">');
    expect(html).not.toContain("on:my-event");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("onfocusin");
  });

  test("hydration attaches both spellings, and reports no mismatch", async () => {
    const html = await renderToString(<Counter />);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    hydrateRoot(<Counter />, container);
    await Promise.resolve();
    await Promise.resolve();

    const button = container.querySelector<HTMLElement>("#b")!;
    button.dispatchEvent(new Event("click", { bubbles: true }));
    button.dispatchEvent(new CustomEvent("my-event"));
    await Promise.resolve();
    await Promise.resolve();

    expect(button.textContent).toBe("2");
    expect(codes).toEqual([]);
    container.remove();
  });
});
