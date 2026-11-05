import { afterEach, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../index";
import { drainSync, drainingNow } from "../core/Task";
import { initDevtoolsBridge } from "../debug/devtoolsBridge";

const realFrame = globalThis.requestAnimationFrame;
afterEach(() => {
  globalThis.requestAnimationFrame = realFrame;
  window.dispatchEvent(new CustomEvent("ramonda:devtools-unwatch"));
});

/**
 * A DEV hook that throws as a drain ends — here the devtools ping, whose frame request fails — must
 * not leave every field believing a drain is running.
 */
test("a drain whose DEV hook throws is over once it has thrown", async () => {
  class Counter extends Component {
    @state count = 0;
    render() {
      return <span>{this.count}</span>;
    }
  }
  const app = await getDOM<Counter>(<Counter />);
  await app.settle();
  initDevtoolsBridge();
  window.dispatchEvent(new CustomEvent("ramonda:devtools-watch"));
  globalThis.requestAnimationFrame = () => {
    throw new Error("a devtools hook failed");
  };
  app.instance.count = 1;

  expect(() => drainSync()).toThrow("a devtools hook failed");
  expect(drainingNow()).toBe(false);
});
