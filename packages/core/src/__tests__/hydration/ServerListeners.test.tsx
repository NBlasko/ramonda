import { describe, expect, test, vi } from "vitest";
import { Component } from "../../base/Component";
import { mount, state } from "../../base/decorators";
import { renderToString } from "../../hydration/ssr";

/**
 * A server render attaches no event listeners.
 *
 * A listener is not an attribute, so `innerHTML` cannot serialize one — attaching on the server was
 * harmless, and that is why it was left alone: skipping it looked like it would cost the client a
 * check to save work nobody sees.
 *
 * Measured, and it is worth it. 100 rows with four handlers each — 400 listeners — rendered in
 * 2.104 ms with them attached and 1.222 ms without: 42% of a listener-heavy server render.
 *
 * The side is read from the OWNING COMPONENT's runtime, not from `getRenderEnv()`. That module-level
 * flag is restored before the first `await`, so anything drained afterwards would see "client"
 * whichever side it is really on. The tests below cover both halves of that.
 */

function countListeners() {
  const target = document.createElement("div");
  let proto: object | null = Object.getPrototypeOf(target);
  while (proto && !Object.getOwnPropertyDescriptor(proto, "addEventListener")) proto = Object.getPrototypeOf(proto);

  const original = (proto as { addEventListener: typeof EventTarget.prototype.addEventListener }).addEventListener;
  const calls: string[] = [];
  const spy = vi.spyOn(proto as EventTarget, "addEventListener").mockImplementation(function (
    this: EventTarget,
    type: string,
    ...rest: unknown[]
  ) {
    calls.push(type);
    return original.apply(this, [type, ...rest] as Parameters<typeof original>);
  } as typeof original);

  return { calls, stop: () => spy.mockRestore() };
}

describe("event listeners and the server", () => {
  test("a server render attaches none", async () => {
    class Row extends Component {
      handle() {}
      render() {
        return (
          <li onClick={this.handle} onFocus={this.handle}>
            row
          </li>
        );
      }
    }

    class Page extends Component {
      render() {
        return (
          <ul>
            <Row />
            <Row />
          </ul>
        );
      }
    }

    const watch = countListeners();
    try {
      const html = await renderToString((<Page />) as never);

      expect(watch.calls).toEqual([]);
      // And the markup is unaffected: a listener was never an attribute to begin with.
      expect(html).toContain("<li>row</li>");
    } finally {
      watch.stop();
    }
  });

  test("a CLIENT render still attaches them, and they fire", async () => {
    // The other half. Skipping on the server is only safe while the client is untouched.
    const { getDOM } = await import("../../test/setup");
    let clicks = 0;

    class Button extends Component {
      @state label = "go";
      press() {
        clicks++;
      }
      render() {
        return (
          <button id="b" onClick={this.press}>
            {this.label}
          </button>
        );
      }
    }

    const app = await getDOM<Button>(<Button />);
    app.container.querySelector<HTMLElement>("#b")!.click();
    await app.settle();

    expect(clicks).toBe(1);
  });

  test("an element created during the DRAIN is still treated as the server", async () => {
    // `renderEnv` is set for the synchronous mount and put back before the first `await`, so a
    // component created during the drain that follows reads "client" from it — which is exactly why
    // the side comes from the owning component's runtime, inherited from its parent. `serverWork.ts`
    // documents the same inheritance for the work collector, and for the same reason.
    class Deferred extends Component {
      @state rows: string[] = [];

      @mount
      async load() {
        await Promise.resolve();
        this.rows = ["a", "b"];
      }

      render() {
        return (
          <ul>
            {this.rows.map((row) => (
              <li key={row} onClick={() => {}}>
                {row}
              </li>
            ))}
          </ul>
        );
      }
    }

    const watch = countListeners();
    try {
      const html = await renderToString((<Deferred />) as never);

      // The rows exist, so the drain really did produce them.
      expect(html).toContain(">a<");
      expect(html).toContain(">b<");
      // And nothing was wired up for a page that will be a string in a moment.
      expect(watch.calls).toEqual([]);
    } finally {
      watch.stop();
    }
  });
});
