import { Component, type RamondaNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { expect, test } from "vitest";
import { Form } from "../Form";
import type { StandardResult, StandardSchemaV1 } from "../types";

/** Takes any value: what is under test is the box, not the schema. */
function anything<V>(): StandardSchemaV1<V, V> {
  return { "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) as StandardResult<V> } };
}

/**
 * A checkbox for a boolean the form may not have yet — an optional one, or one a reset clears — is
 * written `checked={x.value === true}`. `checked={undefined}` is no model to core, and a box with no
 * model keeps whatever it was last ticked as; `=== true` keeps it held, unticked, as `bind` did.
 */
test.each([
  ["value === true", true, false],
  ["value as it is", false, true],
] as const)("a box for an optional boolean, written checked={%s}, after a reset", async (_name, strict, ticked) => {
  const schema = anything<{ agree?: boolean }>();
  let form!: Form<typeof schema>;
  class Page extends Component {
    private f = this.use(Form<typeof schema>, () => ({ schema, defaultValues: {}, onSubmit: () => {} }));
    render(): RamondaNode {
      form = this.f;
      const agree = this.f.fields.agree.$;
      const checked = strict ? agree.value === true : (agree.value as boolean | undefined);
      return <input type="checkbox" aria-label="Agree" checked={checked} oninput={agree.oninput} />;
    }
  }
  const { container, unmount } = render((<Page />) as never);
  try {
    const box = container.querySelector("input") as HTMLInputElement;
    await act(async () => box.click());
    expect({ value: form.values.agree, checked: box.checked }).toEqual({ value: true, checked: true });

    await act(async () => form.reset());

    expect({ value: form.values.agree, checked: box.checked }).toEqual({ value: undefined, checked: ticked });
  } finally {
    unmount();
  }
});
