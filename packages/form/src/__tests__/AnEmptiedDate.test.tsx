import { Component, type RamondaNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { expect, test } from "vitest";
import { Form } from "../Form";
import type { StandardResult, StandardSchemaV1 } from "../types";

/** Takes any value: what is under test is what the control writes, not the schema. */
function anything<V>(): StandardSchemaV1<V, V> {
  return { "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) as StandardResult<V> } };
}

/**
 * A `Date` field emptied through its date input holds the form's own nothing: `null` for a field the
 * form was handed `null` for — a `Date | null` schema — and `undefined` for one it was handed nothing.
 */
test.each([
  ["handed null", null],
  ["handed nothing", undefined],
] as const)("an emptied date field %s holds it again", async (_name, start) => {
  const schema = anything<{ when?: Date | null }>();
  let form: { values: { when?: Date | null } } | undefined;
  class Page extends Component {
    private f = this.use(Form<typeof schema>, () => ({ schema, defaultValues: { when: start }, onSubmit: () => {} }));
    render(): RamondaNode {
      form = this.f;
      const when = this.f.fields.when.$;
      return <input type="date" aria-label="When" name={when.name} value={when.inputValue} oninput={when.oninput} />;
    }
  }
  const { container, unmount } = render((<Page />) as never);
  try {
    const field = container.querySelector("input") as HTMLInputElement;
    for (const typed of ["2026-10-29", ""]) {
      await act(async () => {
        field.value = typed;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    expect(form?.values.when).toBe(start);
  } finally {
    unmount();
  }
});

/** A date input's edit, as the field reads it: the control's `type` and `value`. */
function dateEdit(value: string): Event {
  return { target: { type: "date", value } } as unknown as Event;
}

/**
 * In a list, each row keeps its own nothing as rows are removed and appended: it is remembered by the
 * row, not by its index.
 */
test("an emptied date in a list row holds the null that row was handed, wherever the row moved", async () => {
  type Rows = { rows: { when: Date | null }[] };
  const schema = anything<Rows>();
  let form!: Form<typeof schema>;
  class Page extends Component {
    private f = this.use(Form<typeof schema>, () => ({
      schema,
      defaultValues: { rows: [{ when: new Date(2026, 0, 1) }, { when: null }] },
      onSubmit: () => {},
    }));
    render(): RamondaNode {
      form = this.f;
      return <span>x</span>;
    }
  }
  const { unmount } = render((<Page />) as never);
  try {
    // The second row, handed `null`, is picked while it is the second — and emptied once it is the first.
    await act(async () => form.fields.rows[1].when.$.oninput(dateEdit("2026-10-29")));
    await act(async () => form.fields.rows.$.remove(0));
    await act(async () => form.fields.rows[0].when.$.oninput(dateEdit("")));
    // A row appended with `null`, picked and emptied.
    await act(async () => form.fields.rows.$.append({ when: null }));
    await act(async () => form.fields.rows[1].when.$.oninput(dateEdit("2026-10-29")));
    await act(async () => form.fields.rows[1].when.$.oninput(dateEdit("")));

    expect(form.values.rows.map((row) => row.when)).toEqual([null, null]);
  } finally {
    unmount();
  }
});
