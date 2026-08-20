import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { state } from "../base/decorators";

/**
 * How an event is spelled in JSX, and what it attaches to.
 *
 * The rule is one line: **`on` plus the event's own name**, which is what `eventTypeOf` undoes.
 * `onclick`, `onmouseenter`, `onfocusin`. It is exact rather than approximate — every one of the
 * DOM's 107 element event types is a single lowercase token, so lowercasing can never corrupt one.
 *
 * It used to be `on${Capitalize<name>}`, and that was measured to be a spelling nobody would guess:
 * `onMouseenter`, `onKeydown`, `onDblclick`. The natural `onMouseEnter` was a hard error, and it
 * went unnoticed for as long as it did because every event this repository uses is ONE word, where
 * capitalising the first letter happens to give the right answer.
 */
describe("an event's name in JSX", () => {
  test("a single-word event, and a multi-word one, both reach the listener", async () => {
    const seen: string[] = [];
    class App extends Component {
      render() {
        return (
          <div id="box" onmouseenter={() => seen.push("mouseenter")}>
            <button id="go" onclick={() => seen.push("click")}>
              go
            </button>
          </div>
        );
      }
    }
    const dom = await getDOM(<App />);
    const at = (id: string) => dom.container.querySelector<HTMLElement>(`#${id}`)!;

    at("go").dispatchEvent(new Event("click", { bubbles: true }));
    at("box").dispatchEvent(new Event("mouseenter"));

    expect(seen).toEqual(["click", "mouseenter"]);
    dom.unmount();
  });

  /**
   * The five with no `on…` property on the element, which the old mapping could not name at all:
   * `focusin`, `focusout`, `compositionstart`, `compositionupdate`, `compositionend`.
   *
   * They are not exotic. `focusin` is what you reach for BECAUSE `focus` does not bubble — the same
   * fact `RMD042` is about — and `composition*` is how a reader typing through an IME is handled.
   */
  test("an event with no `on…` property is attachable like any other", async () => {
    const seen: string[] = [];
    class App extends Component {
      render() {
        return (
          <div
            id="field"
            onfocusin={() => seen.push("focusin")}
            onfocusout={() => seen.push("focusout")}
            oncompositionstart={() => seen.push("compositionstart")}
          >
            <input id="i" />
          </div>
        );
      }
    }
    const dom = await getDOM(<App />);
    const input = dom.container.querySelector<HTMLElement>("#i")!;

    input.dispatchEvent(new Event("focusin", { bubbles: true }));
    input.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    input.dispatchEvent(new Event("focusout", { bubbles: true }));

    expect(seen).toEqual(["focusin", "compositionstart", "focusout"]);
    dom.unmount();
  });

  /**
   * `on:` hands the rest of the name through untouched, for the events the first spelling cannot
   * reach: a custom event with a dash, which is what a web component dispatches by convention.
   *
   * Before it existed, `on-my-event` typechecked and attached a listener for `-my-event` — an event
   * nothing in the world dispatches. Silent, and measured: the handler never ran.
   */
  test("`on:` attaches the name exactly as written", async () => {
    const seen: string[] = [];
    class App extends Component {
      render() {
        return <button id="thing" on:my-event={(event) => seen.push(event.type)} />;
      }
    }
    const dom = await getDOM(<App />);
    const button = dom.container.querySelector<HTMLElement>("#thing")!;

    button.dispatchEvent(new CustomEvent("my-event"));
    // The dash is part of the name, not a separator this strips.
    button.dispatchEvent(new CustomEvent("myevent"));

    expect(seen).toEqual(["my-event"]);
    dom.unmount();
  });

  /** A capital survives `on:` too, which is the other thing the lowercase form cannot carry. */
  test("`on:` keeps a capital", async () => {
    const seen: string[] = [];
    class App extends Component {
      render() {
        return <div id="thing" on:DOMSomething={() => seen.push("hit")} />;
      }
    }
    const dom = await getDOM(<App />);
    const node = dom.container.querySelector<HTMLElement>("#thing")!;

    node.dispatchEvent(new CustomEvent("domsomething"));
    expect(seen).toEqual([]);
    node.dispatchEvent(new CustomEvent("DOMSomething"));
    expect(seen).toEqual(["hit"]);
    dom.unmount();
  });

  /** A handler removed between renders is detached, whichever of the two spellings named it. */
  test("both spellings are removed again when the handler goes", async () => {
    const seen: string[] = [];
    class App extends Component {
      @state on = true;
      render() {
        return (
          <button
            id="b"
            onclick={this.on ? () => seen.push("click") : undefined}
            on:my-event={this.on ? () => seen.push("custom") : undefined}
          />
        );
      }
    }
    const dom = await getDOM<App>(<App />);
    const button = dom.container.querySelector<HTMLElement>("#b")!;

    button.dispatchEvent(new Event("click"));
    button.dispatchEvent(new CustomEvent("my-event"));
    expect(seen).toEqual(["click", "custom"]);

    dom.instance.on = false;
    await dom.settle();

    button.dispatchEvent(new Event("click"));
    button.dispatchEvent(new CustomEvent("my-event"));
    expect(seen).toEqual(["click", "custom"]);
    dom.unmount();
  });
});
