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
 * A `Date` field emptied through its date input holds nothing — `undefined` — whatever the form was
 * handed for it: what the schema calls nothing is the schema's, and a date that may be empty takes
 * `undefined` (`z.date().nullish()`).
 */
test.each([
  ["handed null", null],
  ["handed a day", new Date(2026, 0, 1)],
  ["handed nothing", undefined],
] as const)("an emptied date field %s holds undefined", async (_name, start) => {
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
    expect(form?.values.when).toBe(undefined);
  } finally {
    unmount();
  }
});
