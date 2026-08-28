import { beforeEach, describe, expect, test } from "vitest";
import { Component } from "../base/Component";
import { Listener } from "../base/Listener";
import { renderToString } from "../hydration/ssr";
import { getDOM } from "../test/setup";
import type { RamondaNode } from "../types/vdom";

/**
 * `Listener` — a listener the app arms and disarms, which the framework still removes.
 *
 * `@onWindow` attaches for the owner's whole life, which is right for most listeners and wrong for
 * the ones this exists for: a `keydown` while a dialog is open, a `pointermove` while a drag is
 * happening. Written by hand each is an `addEventListener` and a `removeEventListener` that have to
 * agree with each other and with teardown — three places for one fact, which is where the leak lives.
 *
 * **The half that matters most is teardown**, exactly as it is for the timers: a listener armed on a
 * click keeps the component reachable and then writes into something that is gone. Every arming here
 * is asserted silent after unmount.
 *
 * **The other half is WHERE each value is read**, which is the whole reason `run` sits in the props
 * bag while the target, the type and the options are captured at arm time. Removal matches on the
 * triple of type, function identity and capture; `run` is not part of that and may change freely.
 */

let log: string[] = [];

beforeEach(() => {
  log = [];
});

class Dialog extends Component {
  escape = this.use(Listener, () => ({
    on: "document" as const,
    type: "keydown",
    run: this.onKey,
  }));

  private onKey(event: Event): void {
    log.push((event as KeyboardEvent).key);
  }

  render(): RamondaNode {
    return <div>dialog</div>;
  }
}

const press = (key: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key }));

describe("Listener", () => {
  test("hears nothing until it is armed, and everything after", async () => {
    const app = await getDOM<Dialog>(<Dialog />);

    press("a");
    expect(log).toEqual([]);

    expect(app.instance.escape.listen()).toBe(true);
    press("b");
    expect(log).toEqual(["b"]);
  });

  test("and nothing again once it is stopped", async () => {
    const app = await getDOM<Dialog>(<Dialog />);
    app.instance.escape.listen();

    app.instance.escape.stop();
    press("c");
    expect(log).toEqual([]);
  });

  /**
   * Arming twice leaves ONE listener, not two.
   *
   * `listen()` removes what this instance already had before attaching — the same contract `start`
   * keeps for the timers. Without it a component that arms on every open would stack a listener per
   * open and call `run` once per stacked copy, which looks like a bug in the handler.
   */
  test("arming again replaces, so an event is heard once", async () => {
    const app = await getDOM<Dialog>(<Dialog />);
    app.instance.escape.listen();
    app.instance.escape.listen();

    press("d");
    expect(log).toEqual(["d"]);
  });

  /**
   * Teardown removes it, and this is the leak the hook exists to make impossible.
   *
   * Nothing in the component says so: there is no `@destroyed` here, and no field holding a handler
   * to remove. One hook instance is one listener, and the framework owns the removal.
   */
  test("teardown removes it, with nothing written to say so", async () => {
    const app = await getDOM<Dialog>(<Dialog />);
    app.instance.escape.listen();

    await app.unmount();
    press("e");
    expect(log).toEqual([]);
  });

  /**
   * A server render arms nothing and says so, rather than throwing.
   *
   * `document` does not exist there, and a component that renders on both sides must not have to
   * branch on which — the same reason `@onWindow` resolves to `null` instead of failing.
   */
  test("on the server it refuses, and the render is unaffected", async () => {
    const html = await renderToString(<Dialog />);

    expect(html).toContain("dialog");
    expect(log).toEqual([]);
  });
});
