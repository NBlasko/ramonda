import { Component, type RamondaNode } from "@ramonda/core";
import { render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { Form } from "../Form";
import type { StandardSchemaV1 } from "../types";

/**
 * `setError` on the field itself — `f.players.$.setError(message)`.
 *
 * Found by an agent building an app from the docs alone: mapping a server's answer onto a field took
 * `form.setError("players", code)`, a string path, in a library whose point is that `f.adress` is a
 * compile error. The string form stays, for a field named by an API; the handle is the typed door.
 */
interface Values {
  name: string;
  contacts: { value: string }[];
}

const passes: StandardSchemaV1<Values, Values> = {
  "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value: value as Values }) },
};

function mount() {
  let form!: Form<typeof passes>;
  class Page extends Component {
    private f = this.use(Form<typeof passes>, () => ({
      schema: passes,
      defaultValues: { name: "", contacts: [{ value: "a" }, { value: "b" }] },
      onSubmit: () => {},
    }));
    render(): RamondaNode {
      form = this.f;
      return <form id="f" />;
    }
  }
  const mounted = render((<Page />) as never);
  return { form, ...mounted };
}

describe("a field's own setError", () => {
  test("puts the message on that field, and marks it touched so the message shows", () => {
    const { form, unmount } = mount();
    try {
      form.fields.name.$.setError("taken");
      expect(form.fields.name.$.error).toBe("taken");
      expect(form.fields.name.$.touched).toBe(true);
    } finally {
      unmount();
    }
  });

  test("reaches a field inside a list row, the same field the string path names", () => {
    const { form, unmount } = mount();
    try {
      form.fields.contacts[1].value.$.setError("not an address");
      expect(form.fields.contacts[1].value.$.error).toBe("not an address");
      expect(form.fields.contacts[0].value.$.error).toBeUndefined();
      form.setError("contacts[0].value", "also wrong");
      expect(form.fields.contacts[0].value.$.error).toBe("also wrong");
    } finally {
      unmount();
    }
  });

  test("a field that is not in the schema is a type error, not a string nobody checks", () => {
    const { form, unmount } = mount();
    try {
      // Checked by the type check, which this suite runs: never called, so it asserts nothing at runtime.
      const typo = () => {
        // @ts-expect-error — `nmae` is not a field of the schema.
        form.fields.nmae.$.setError("x");
      };
      expect(typeof typo).toBe("function");
    } finally {
      unmount();
    }
  });
});
