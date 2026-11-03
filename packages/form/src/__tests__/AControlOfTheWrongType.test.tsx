import { Component, Select, type RamondaNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Form } from "../Form";
import type { StandardResult, StandardSchemaV1 } from "../types";

/** Takes any value: what is under test is the control, not the schema. */
function anything<V>(): StandardSchemaV1<V, V> {
  return { "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) as StandardResult<V> } };
}

let records: RamondaDiagnostic[];
beforeEach(() => {
  records = [];
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
  vi.restoreAllMocks();
});

/**
 * RMF005 — a field holding a number or a day, edited through a control that hands back text. Reported
 * once per field, naming what its control hands back and the control it belongs in; a control of
 * the right type, and a field still empty, say nothing.
 */
test.each([
  ["a number field without its type", 41, undefined, "12", 'hands back text: it belongs in `<input type="number">`'],
  ["a number field written type=number", 41, "number", "12", undefined],
  ["a number field on a slider", 41, "range", "12", undefined],
  [
    "a date field without its type",
    new Date(2026, 0, 1),
    undefined,
    "2026-10-28",
    'hands back text: it belongs in `<input type="date">`',
  ],
  ["a date field written type=date", new Date(2026, 0, 1), "date", "2026-10-28", undefined],
  ["a number field still empty", undefined, undefined, "12", undefined],
  [
    "a number field on a checkbox",
    41,
    "checkbox",
    "12",
    'hands back true or false: it belongs in `<input type="number">`',
  ],
  [
    "a text field on a slider",
    "abc",
    "range",
    "12",
    'holds text, and its control (`type="range"`) hands back a number',
  ],
  [
    "a text field in a number input",
    "abc",
    "number",
    "12",
    'holds text, and its control (`type="number"`) hands back a number',
  ],
  ["an empty text field on a slider", "", "range", "12", undefined],
  [
    "a box's field in a text input",
    true,
    undefined,
    "x",
    'holds true or false, and its control (`type="text"`) hands back text',
  ],
  ["a box's field on a checkbox", true, "checkbox", "x", undefined],
  ["a box's field on a radio, which writes its own value", true, "radio", "false", undefined],
  [
    "a text field on a checkbox",
    "abc",
    "checkbox",
    "12",
    'holds text, and its control (`type="checkbox"`) hands back true or false',
  ],
  [
    "a date field on a slider",
    new Date(2026, 0, 1),
    "range",
    "12",
    'hands back a number: it belongs in `<input type="date">`',
  ],
  [
    "a number field in a date input",
    41,
    "date",
    "2026-10-29",
    'hands back a day: it belongs in `<input type="number">`',
  ],
] as const)("%s", async (_name, start, type, typed, reported) => {
  const schema = anything<{ x?: number | Date | string | boolean }>();
  class Page extends Component {
    private f = this.use(Form<typeof schema>, () => ({ schema, defaultValues: { x: start }, onSubmit: () => {} }));
    render(): RamondaNode {
      const x = this.f.fields.x.$;
      return <input type={type} aria-label="X" name={x.name} oninput={x.oninput} />;
    }
  }
  const { container, unmount } = render((<Page />) as never);
  try {
    const field = container.querySelector("input") as HTMLInputElement;
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        field.value = typed;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    const found = records.filter((record) => record.code === "RMF005");
    expect(found.length).toBe(reported === undefined ? 0 : 1);
    if (reported !== undefined) expect(found[0]?.message).toContain(reported);
  } finally {
    unmount();
  }
});

/** A boolean field set through a `Select` — "No" picked as "false" — is no box in the wrong control. */
test("a box's field through a Select is not reported", async () => {
  const schema = anything<{ x?: boolean | string }>();
  class Page extends Component {
    private f = this.use(Form<typeof schema>, () => ({ schema, defaultValues: { x: true }, onSubmit: () => {} }));
    render(): RamondaNode {
      const x = this.f.fields.x.$;
      return (
        <Select aria-label="X" name={x.name} value={String(this.f.values.x)} oninput={x.oninput}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </Select>
      );
    }
  }
  const { container, unmount } = render((<Page />) as never);
  try {
    const select = container.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      select.value = "false";
      select.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(records.filter((record) => record.code === "RMF005")).toEqual([]);
  } finally {
    unmount();
  }
});

/** A number field chosen through radios is told the same: a radio hands back its own `value`, as text. */
test("a number field through radios is told to take the choice as a number", async () => {
  const schema = anything<{ x?: number | string }>();
  class Page extends Component {
    private f = this.use(Form<typeof schema>, () => ({ schema, defaultValues: { x: 1 }, onSubmit: () => {} }));
    render(): RamondaNode {
      const x = this.f.fields.x.$;
      return (
        <div>
          <input
            type="radio"
            aria-label="One"
            name={x.name}
            value="1"
            checked={this.f.values.x === 1}
            oninput={x.oninput}
          />
          <input
            type="radio"
            aria-label="Two"
            name={x.name}
            value="2"
            checked={this.f.values.x === 2}
            oninput={x.oninput}
          />
        </div>
      );
    }
  }
  const { container, unmount } = render((<Page />) as never);
  try {
    const two = container.querySelectorAll("input")[1] as HTMLInputElement;
    await act(async () => {
      two.checked = true;
      two.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const found = records.filter((record) => record.code === "RMF005");
    expect(found.map((record) => record.message.includes("z.coerce.number()"))).toEqual([true]);
    expect(found[0]?.message).not.toContain('<input type="number">');
  } finally {
    unmount();
  }
});

/**
 * A number field in a `Select` is told what fixes it: a select hands back the chosen option's text, and
 * no `<input type="number">` picks from a list — the schema takes the choice as a number.
 */
test("a number field through a Select is told to take the choice as a number", async () => {
  const schema = anything<{ x?: number | string }>();
  class Page extends Component {
    private f = this.use(Form<typeof schema>, () => ({ schema, defaultValues: { x: 1 }, onSubmit: () => {} }));
    render(): RamondaNode {
      const x = this.f.fields.x.$;
      return (
        <Select aria-label="X" name={x.name} value={String(this.f.values.x)} oninput={x.oninput}>
          <option value="1">One</option>
          <option value="2">Two</option>
        </Select>
      );
    }
  }
  const { container, unmount } = render((<Page />) as never);
  try {
    const select = container.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      select.value = "2";
      select.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const found = records.filter((record) => record.code === "RMF005");
    expect(found.map((record) => record.message.includes("z.coerce.number()"))).toEqual([true]);
    expect(found[0]?.message).not.toContain('<input type="number">');
  } finally {
    unmount();
  }
});
