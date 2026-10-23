import { afterEach, beforeEach, expect, test } from "vitest";
import { Component } from "../../base/Component";
import { mounted, state } from "../../base/decorators";
import { createRef } from "../../base/Ref";
import { bootstrap, unmount } from "../../index";
import { flushSync } from "../../testing";
import { resetFaults } from "../../debug/fault";
import type { EventOn } from "../../types/commonTypes";

/**
 * RMD062 in a production build: a field that read its model while the render of its last edit was
 * waiting for the running commit. What happened ships, as a record for the app's collector; the
 * advice stays in development. The edit is answered as in development.
 */
const records: RamondaDiagnostic[] = [];

beforeEach(() => {
  resetFaults();
  records.length = 0;
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
});

afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
});

class Shout extends Component {
  @state text = "";
  field = createRef<HTMLInputElement>();
  typed(event: EventOn<HTMLInputElement>) {
    this.text = event.currentTarget.value.toUpperCase();
  }
  keep(next: string): string {
    return next;
  }
  @mounted
  fill() {
    const field = this.field.current as HTMLInputElement;
    for (const text of ["a", "ab"]) {
      field.value = text;
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    }
  }
  render() {
    return <input aria-label="Shout" ref={this.field} value={this.text} oninput={this.typed} transform={this.keep} />;
  }
}

test("a second edit from a @mounted, read ahead of its render, is recorded without its advice", () => {
  expect(__DEV__).toBe(false);
  const container = document.createElement("div");
  document.body.appendChild(container);
  bootstrap(<Shout />, container);
  flushSync();

  const record = records.find((r) => r.code === "RMD062");
  expect(record).toBeDefined();
  expect(record!.fix).toBeUndefined();
  // The severity development gives it, so one fault is one series in a collector.
  expect(record!.severity).toBe("warn");
  expect((container.querySelector("input") as HTMLInputElement).value).toBe("AB");

  unmount(container);
  container.remove();
});
