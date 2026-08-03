import { Component, INSPECT, type RamondaNode } from "@ramonda/core";
import { render } from "@ramonda/testing-library";
import { describe, expect, test, vi } from "vitest";
import { Form } from "../Form";
import type { StandardResult, StandardSchemaV1, ValidateOn } from "../types";

/**
 * The form's state machine, driven through a real mount so `@state` and `@destroy` are the
 * ones the framework runs.
 *
 * The schemas are hand-built rather than taken from a validator, which keeps the suite
 * about what the FORM does with a Standard Schema result — every validator that implements
 * the spec reaches this code the same way.
 */
interface Values {
  email: string;
  password: string;
  confirm: string;
}

const EMPTY: Values = { email: "", password: "", confirm: "" };

/** A schema in the spec's own terms: issues carry a path, and everything is collected. */
function schemaOf(check: (values: Values) => { path: string[]; message: string }[], async = false) {
  const schema: StandardSchemaV1<Values, Values> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => {
        const issues = check(value as Values);
        const result: StandardResult<Values> =
          issues.length === 0 ? { value: value as Values } : { issues: issues.map((i) => ({ ...i })) };
        return async ? Promise.resolve(result) : result;
      },
    },
  };
  return schema;
}

/** Passwords must match — the rule that only works if editing ONE field re-answers the OTHER. */
const matching = schemaOf((values) =>
  values.confirm !== values.password ? [{ path: ["confirm"], message: "the same password" }] : [],
);

function mount(
  schema: StandardSchemaV1<Values, Values>,
  options?: { onSubmit?: (v: Values) => void | Promise<void>; validateOn?: ValidateOn },
) {
  let form!: Form<typeof schema>;

  class Page extends Component {
    private f = this.use(Form<typeof schema>, {
      schema,
      defaultValues: EMPTY,
      onSubmit: options?.onSubmit ?? (() => {}),
      validateOn: options?.validateOn,
    });

    render(): RamondaNode {
      form = this.f;
      return <form id="f" />;
    }
  }

  const mounted = render((<Page />) as never);
  return { form, ...mounted };
}

describe("validation", () => {
  test("nothing is shown before the field has been touched", () => {
    // A form that is red before it has been filled in is telling the user off for not
    // having typed yet.
    const { form, unmount } = mount(matching);
    try {
      form.fields.password.$.set("hunter2");

      expect(form.isValid).toBe(false);
      expect(form.fields.confirm.$.error).toBeUndefined();
    } finally {
      unmount();
    }
  });

  test("a touched field shows its message, and loses it when fixed", () => {
    const { form, unmount } = mount(matching);
    try {
      form.fields.password.$.set("hunter2");
      form.fields.confirm.$.set("hunter1");

      expect(form.fields.confirm.$.error).toBe("the same password");
      expect(form.fields.confirm.$.errors).toEqual(["the same password"]);

      form.fields.confirm.$.set("hunter2");
      expect(form.fields.confirm.$.error).toBeUndefined();
      expect(form.isValid).toBe(true);
    } finally {
      unmount();
    }
  });

  test("editing one field re-answers the rule that lives on another", () => {
    // The whole reason the default is to re-run the schema rather than the one field:
    // `confirm`'s rule reads `password`, so moving PASSWORD has to re-answer CONFIRM.
    const { form, unmount } = mount(matching);
    try {
      form.fields.confirm.$.set("hunter2");
      expect(form.fields.confirm.$.error).toBe("the same password");

      form.fields.password.$.set("hunter2");
      expect(form.fields.confirm.$.error).toBeUndefined();
    } finally {
      unmount();
    }
  });

  test("a submit reveals every message, including on fields nobody visited", async () => {
    const onSubmit = vi.fn();
    const schema = schemaOf((values) => (values.email === "" ? [{ path: ["email"], message: "required" }] : []));
    const { form, unmount } = mount(schema, { onSubmit });
    try {
      form.submit();
      await Promise.resolve();

      expect(form.fields.email.$.error).toBe("required");
      expect(form.submitCount).toBe(1);
      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  test("a valid submit hands `onSubmit` what the schema produced", async () => {
    const onSubmit = vi.fn();
    const schema = schemaOf(() => []);
    const { form, unmount } = mount(schema, { onSubmit });
    try {
      form.fields.email.$.set("a@b.c");
      form.submit();
      await Promise.resolve();
      await Promise.resolve();

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({ ...EMPTY, email: "a@b.c" });
      expect(form.isSubmitting).toBe(false);
    } finally {
      unmount();
    }
  });

  test("an async schema is awaited, and the stale answer is dropped", async () => {
    // Two edits in flight at once: the first must not land over the second, or the form
    // shows a verdict on values it has already moved past.
    const seen: string[] = [];
    const schema: StandardSchemaV1<Values, Values> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: async (value) => {
          const values = value as Values;
          seen.push(values.email);
          // The FIRST call resolves last, which is the ordering that breaks a naive form.
          await new Promise((r) => setTimeout(r, values.email === "one" ? 20 : 1));
          return values.email === "two" ? { value: values } : { issues: [{ path: ["email"], message: "no" }] };
        },
      },
    };

    const { form, unmount } = mount(schema);
    try {
      form.fields.email.$.set("one");
      form.fields.email.$.set("two");
      await new Promise((r) => setTimeout(r, 40));

      // The empty string is the priming call: the form validates its defaults once at creation
      // so `isValid` is not a claim made without looking.
      expect(seen).toEqual(["", "one", "two"]);
      expect(form.fields.email.$.error).toBeUndefined();
      expect(form.isValid).toBe(true);
    } finally {
      unmount();
    }
  });

  test("a submit superseded mid-flight releases the button instead of wedging it", async () => {
    /**
     * Typing one character while an ASYNC schema is out used to disable the submit button forever.
     *
     * `finish` drops a verdict that a later validation has superseded — right, because it is about
     * values the form has moved past — but it returned without releasing `submitting`, and nothing
     * else ever would. A synchronous schema has already been through `finish` before anything can
     * intervene, which is why every existing test missed it.
     *
     * Found while wiring up late `defaultValues`, which reaches the same path: a record landing
     * from a fetch during a submit supersedes it exactly as a keystroke does.
     */
    const schema = schemaOf(() => [], true);
    const { form, unmount } = mount(schema);
    try {
      form.submit();
      expect(form.isSubmitting).toBe(true);

      // Inside the window: the schema's promise has not resolved yet.
      form.fields.email.$.set("typed during the submit");
      await new Promise((r) => setTimeout(r, 10));

      expect(form.isSubmitting).toBe(false);
    } finally {
      unmount();
    }
  });

  test("`validateOn: blur` waits for the blur", () => {
    const schema = schemaOf((values) => (values.email === "" ? [{ path: ["email"], message: "required" }] : []));
    const { form, unmount } = mount(schema, { validateOn: "blur" });
    try {
      form.fields.email.$.set("x");
      form.fields.email.$.set("");
      expect(form.fields.email.$.error).toBeUndefined();

      form.fields.email.$.bind.onBlur?.(new Event("blur"));
      expect(form.fields.email.$.error).toBe("required");
    } finally {
      unmount();
    }
  });

  test("a root issue is a form error rather than a field's", () => {
    const schema = schemaOf(() => [{ path: [], message: "that combination is not allowed" }]);
    const { form, unmount } = mount(schema);
    try {
      form.submit();

      expect(form.formErrors).toEqual(["that combination is not allowed"]);
      expect(form.fields.email.$.error).toBeUndefined();
    } finally {
      unmount();
    }
  });

  test("`setError` puts the server's answer on a field, and shows it at once", () => {
    const { form, unmount } = mount(schemaOf(() => []));
    try {
      form.setError("email", "already registered");

      // Marked touched too, or the message would be computed and then hidden.
      expect(form.fields.email.$.error).toBe("already registered");
      expect(form.fields.email.$.touched).toBe(true);
    } finally {
      unmount();
    }
  });

  test("`reset` puts everything back, including what had been touched", () => {
    const { form, unmount } = mount(matching);
    try {
      form.fields.password.$.set("hunter2");
      form.fields.confirm.$.set("nope");
      expect(form.isDirty).toBe(true);

      form.reset();

      expect(form.values).toEqual(EMPTY);
      expect(form.isDirty).toBe(false);
      expect(form.fields.confirm.$.error).toBeUndefined();
      expect(form.fields.confirm.$.touched).toBe(false);
      expect(form.submitCount).toBe(0);
    } finally {
      unmount();
    }
  });

  test("`dirty` is per field, and compares against the default", () => {
    const { form, unmount } = mount(matching);
    try {
      expect(form.fields.email.$.dirty).toBe(false);

      form.fields.email.$.set("a@b.c");
      expect(form.fields.email.$.dirty).toBe(true);
      expect(form.fields.password.$.dirty).toBe(false);

      // Back to what it was: dirty is about the VALUE, not about having been edited.
      form.fields.email.$.set("");
      expect(form.fields.email.$.dirty).toBe(false);
    } finally {
      unmount();
    }
  });

  test("an `onSubmit` that throws is reported, not swallowed and not rethrown", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { form, unmount } = mount(
      schemaOf(() => []),
      {
        onSubmit: () => {
          throw new Error("network");
        },
      },
    );
    try {
      // `submit` is called from a DOM event, where a rejection has nobody to catch it.
      expect(() => form.submit()).not.toThrow();
      await Promise.resolve();
      await Promise.resolve();

      expect(spy).toHaveBeenCalledWith(expect.stringContaining("RMF003"), expect.any(Error));
      expect(form.isSubmitting).toBe(false);
    } finally {
      spy.mockRestore();
      unmount();
    }
  });

  test("the defaults are validated once, before anything is rendered", () => {
    // `isValid` must not be a claim made without looking. An untouched form used to report
    // `true` purely because no messages had been recorded — visible on a server-rendered page,
    // where nothing has had a chance to interact.
    const required = schemaOf((values) => (values.email === "" ? [{ path: ["email"], message: "required" }] : []));

    const invalid = mount(required);
    try {
      expect(invalid.form.isValid).toBe(false);
      // Computed, but not SHOWN — nobody has been near the field yet.
      expect(invalid.form.fields.email.$.error).toBeUndefined();
    } finally {
      invalid.unmount();
    }

    const fine = mount(schemaOf(() => []));
    try {
      // And a form whose defaults are already good says so, so `disabled={!isValid}` works.
      expect(fine.form.isValid).toBe(true);
    } finally {
      fine.unmount();
    }
  });

  test("two forms on one page cannot reach each other's state", () => {
    // Every form starts pointing at the same shared empty issue map, so the question is
    // whether one form writing errors leaks into another. It cannot: a form only ever
    // REPLACES its map, and `collect`, `withIssue` and `forgetUnder` each build a new one.
    const schema = schemaOf((values) => (values.email === "" ? [{ path: ["email"], message: "required" }] : []));

    let left!: Form<typeof schema>;
    let right!: Form<typeof schema>;

    class Pair extends Component {
      private a = this.use(Form<typeof schema>, { schema, defaultValues: EMPTY, onSubmit: (_v) => {} });
      private b = this.use(Form<typeof schema>, { schema, defaultValues: EMPTY, onSubmit: (_v) => {} });

      render(): RamondaNode {
        left = this.a;
        right = this.b;
        return <form />;
      }
    }

    const { unmount } = render((<Pair />) as never);
    try {
      left.submit();

      expect(left.fields.email.$.error).toBe("required");
      expect(right.fields.email.$.error).toBeUndefined();
      expect(right.submitCount).toBe(0);
      // Both are invalid — their defaults are empty — but only the one that was submitted is
      // SHOWING anything, which is what proves the maps are not shared.
      expect(right.errorsAt([])).toEqual([]);

      // And the values, the touch marks and the row ids are per form too.
      left.fields.email.$.set("a@b.c");
      expect(right.values.email).toBe("");
      expect(right.fields.email.$.touched).toBe(false);

      // Resetting one puts only that one back.
      right.setError("password", "server said no");
      left.reset();
      expect(right.fields.password.$.error).toBe("server said no");
    } finally {
      unmount();
    }
  });

  test("nothing lands after the form is gone", async () => {
    let resolve!: (r: StandardResult<Values>) => void;
    const schema: StandardSchemaV1<Values, Values> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => new Promise<StandardResult<Values>>((r) => (resolve = r)),
      },
    };

    const { form, unmount } = mount(schema);
    form.fields.email.$.set("x");
    unmount();

    // Resolving into a destroyed hook must not write state — that is a render scheduled on
    // a tree that no longer exists.
    expect(() => resolve({ issues: [{ path: ["email"], message: "late" }] })).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(form.fields.email.$.error).toBeUndefined();
  });
});

describe("[INSPECT] - what the devtools panel sees", () => {
  const inspect = (form: object) => (form as Record<symbol, () => Record<string, unknown>>)[INSPECT]();

  test("reports the values, messages and flags that `@state` cannot show", () => {
    // Without this the panel row reads `{ version: n }` and props that never change: a counter
    // going up, and nothing anyone would open the panel to look at.
    const { form, unmount } = mount(matching);
    try {
      form.fields.confirm.$.set("mismatch");
      form.submit();

      const detail = inspect(form);

      expect(detail.values).toEqual(form.values);
      expect(detail.errors).toMatchObject({ confirm: ["the same password"] });
      expect(detail.changed).toContain("confirm");
      expect(detail.isValid).toBe(false);
      expect(detail.submitCount).toBe(1);
    } finally {
      unmount();
    }
  });

  test("names a path the way the reader wrote it, not the way the map keys it", () => {
    // `pathKey` separates segments with a NUL and marks an index with `#`, so two different paths
    // cannot collide. Neither is readable, and the panel is the one place these are shown to a
    // person.
    const { form, unmount } = mount(matching);
    try {
      form.fields.confirm.$.set("mismatch");
      form.submit();

      const named = Object.keys(inspect(form).errors as Record<string, unknown>);

      expect(named.length).toBeGreaterThan(0);
      for (const key of named) {
        expect(key).not.toContain("\\u0000");
        expect(key).not.toContain("#");
      }
    } finally {
      unmount();
    }
  });
});
