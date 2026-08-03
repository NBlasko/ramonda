import { describe, expect, test, vi } from "vitest";
import { Component } from "@ramonda/core";
import { render } from "@ramonda/testing-library";
import { Form } from "../../Form";
import type { StandardResult, StandardSchemaV1 } from "../../types";

/**
 * The production run: what still has to WORK with `__DEV__` false, and what has to go quiet.
 *
 * Two different things live behind guards in this package and they must not be confused:
 *
 * - **RMF003** is a diagnostic. It is entirely inside `if (__DEV__)`, so here a thrown
 *   `onSubmit` must reach `console.error` through nothing of ours.
 * - **RMF001** is not. Assigning to a field throws in production too, because there is no
 *   correct program in which that assignment does something — dropping the write silently
 *   would leave the form's values disagreeing with what the reader can see.
 *
 * See `vitest.prod.config.ts` for why this is a separate process.
 */

interface Values {
  email: string;
  tags: string[];
}

const schema: StandardSchemaV1<Values, Values> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const values = value as Values;
      const issues = values.email.includes("@") ? [] : [{ path: ["email"], message: "an email address" }];
      const result: StandardResult<Values> = issues.length === 0 ? { value: values } : { issues };
      return result;
    },
  },
};

function mount(onSubmit: (values: Values) => void | Promise<void> = () => {}) {
  let form!: Form<typeof schema>;

  class Page extends Component {
    private f = this.use(Form<typeof schema>, {
      schema,
      defaultValues: { email: "", tags: ["a"] },
      onSubmit,
    });

    render() {
      form = this.f;
      return null;
    }
  }

  const mounted = render((<Page />) as never);
  return { form, ...mounted };
}

describe("production build", () => {
  test("__DEV__ is false in this run", () => {
    // Without this the rest of the file would be testing the development path again.
    expect(__DEV__).toBe(false);
  });

  test("a thrown `onSubmit` is not reported — RMF003 does not exist here", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { form, unmount } = mount(() => {
      throw new Error("no");
    });
    try {
      form.fields.email.$.set("a@b.c");
      form.submit();
      await Promise.resolve();
      await Promise.resolve();

      expect(errors).not.toHaveBeenCalled();
      // And the form is not left stuck mid-flight.
      expect(form.isSubmitting).toBe(false);
    } finally {
      errors.mockRestore();
      unmount();
    }
  });

  test("assigning to a field still throws — RMF001 is a guard, not a diagnostic", () => {
    const { form, unmount } = mount();
    try {
      expect(() => {
        (form.fields.email as unknown as { $: unknown }).$ = "a@b.c";
      }).toThrow(TypeError);
      // The write landed nowhere, which is the whole point of refusing it.
      expect(form.values.email).toBe("");
    } finally {
      unmount();
    }
  });

  test("the list members still refuse a field that is not a list", () => {
    const { form, unmount } = mount();
    try {
      expect(() => (form.fields.email as unknown as { $: { rows: unknown } }).$.rows).toThrow(TypeError);
    } finally {
      unmount();
    }
  });

  test("validation, messages and submit all still work", async () => {
    const seen: Values[] = [];
    const { form, unmount } = mount((values) => {
      seen.push(values);
    });
    try {
      expect(form.isValid).toBe(false);

      form.submit();
      expect(form.fields.email.$.error).toBe("an email address");
      expect(seen).toHaveLength(0);

      form.fields.email.$.set("a@b.c");
      expect(form.isValid).toBe(true);
      expect(form.fields.email.$.error).toBeUndefined();

      form.submit();
      await Promise.resolve();
      expect(seen).toEqual([{ email: "a@b.c", tags: ["a"] }]);
    } finally {
      unmount();
    }
  });

  test("array rows still keep their identity across a splice", () => {
    const { form, unmount } = mount();
    try {
      form.fields.tags.$.append("b");
      const before = form.fields.tags.$.rows.map((row) => row.id);

      form.fields.tags.$.remove(0);

      expect(form.fields.tags.$.rows.map((row) => row.id)).toEqual([before[1]]);
      expect(form.values.tags).toEqual(["b"]);
    } finally {
      unmount();
    }
  });
});
