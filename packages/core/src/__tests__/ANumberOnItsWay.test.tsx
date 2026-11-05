import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component, type EventOn } from "../index";

/**
 * A number field typed toward a number it cannot hold yet — `-` on the way to `-3`, `1e` on the way
 * to `1e5` — reports `""`, as the browser cannot read it. A model that follows the field holds `""`
 * then, which is what the field already says, and the render that follows writes nothing: writing
 * `""` would take the `-` away (measured in Chromium, `browser/fields.spec.ts`). jsdom keeps no such
 * text, so what is asked here is whether the field is written at all.
 */
class Signed extends Component {
  @state amount: number | "" = 5;

  typed(event: EventOn<HTMLInputElement>) {
    const typed = event.currentTarget.value;
    this.amount = typed === "" ? "" : Number(typed);
  }

  render() {
    return <input id="n" type="number" aria-label="Amount" value={this.amount} oninput={this.typed} />;
  }
}

/** Every value the framework writes to this field's `value` property from here on. */
function writesTo(field: HTMLInputElement): unknown[] {
  const writes: unknown[] = [];
  const own = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  Object.defineProperty(field, "value", {
    configurable: true,
    get() {
      return own?.get?.call(this);
    },
    set(next: unknown) {
      writes.push(next);
      own?.set?.call(this, next);
    },
  });
  return writes;
}

describe("a number field on its way to a number", () => {
  test("a field that reports nothing, with a model that holds nothing, is not written", async () => {
    const app = await getDOM<Signed>(<Signed />);
    await app.settle();
    const field = app.container.querySelector("#n") as HTMLInputElement;
    field.focus();
    field.value = "";
    const writes = writesTo(field);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "-" }));
    await app.settle();

    expect({ model: app.instance.amount, writes }).toEqual({ model: "", writes: [] });
  });

  test("a model the field does not show is written", async () => {
    const app = await getDOM<Signed>(<Signed />);
    await app.settle();
    const field = app.container.querySelector("#n") as HTMLInputElement;
    const writes = writesTo(field);
    app.instance.amount = 7;
    await app.settle();

    expect({ shown: field.value, writes }).toEqual({ shown: "7", writes: [7] });
  });
});
