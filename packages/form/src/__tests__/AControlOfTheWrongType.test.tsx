import { Component, type RamondaNode } from "@ramonda/core";
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
] as const)("%s", async (_name, start, type, typed, reported) => {
  const schema = anything<{ x?: number | Date }>();
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
