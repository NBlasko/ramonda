import { Component, type RamondaNode, compute } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test, vi } from "vitest";
import { Form } from "../Form";
import { FormState } from "../formState";
import { Field } from "../field";
import type { FieldNode, StandardResult, StandardSchemaV1 } from "../types";

/**
 * A component watching the FORM rather than a field: a save button.
 *
 * The whole reason it exists is the thing it must not do. `<button disabled={!form.isValid}>` written in
 * the owner's render is what ties the owner to every keystroke — so this hook has to wake on an answer
 * that MOVED (validity flipping, a submit starting) and sleep through the typing in between. A form-wide
 * counter cannot tell those apart, which is why the form compares each fact to the one it last
 * published.
 */

interface Values {
  email: string;
  name: string;
}

const EMPTY: Values = { email: "", name: "" };

/** `email` must be non-empty, so validity can be flipped on purpose. */
const schema: StandardSchemaV1<Values, Values> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const values = value as Values;
      return (
        values.email === "" ? { issues: [{ message: "required", path: ["email"] }] } : { value: values }
      ) as StandardResult<Values>;
    },
  },
};

let renders: Record<string, number> = {};
function count(label: string): void {
  renders[label] = (renders[label] ?? 0) + 1;
}

/** No props at all: it finds the form on the context the form published itself. */
class SaveButton extends Component {
  private form = this.use(FormState);

  render(): RamondaNode {
    count("save");
    return (
      <button id="save" disabled={!this.form.isValid || this.form.isSubmitting}>
        {this.form.isSubmitting ? "Saving…" : "Save"}
      </button>
    );
  }
}

class TextField extends Component<{ of: FieldNode<string>; id: string }> {
  private f = this.use(Field<string>, () => ({ of: this.props.of }));

  render(): RamondaNode {
    count(this.props.id);
    return <input id={this.props.id} {...this.f.bind} />;
  }
}

function mount(onSubmit: (values: Values) => void | Promise<void> = () => {}) {
  let form!: Form<typeof schema>;
  class Page extends Component {
    private f = this.use(Form<typeof schema>, () => ({ schema, defaultValues: EMPTY, onSubmit }));

    render(): RamondaNode {
      count("page");
      form = this.f;
      return (
        <form>
          <TextField id="email" of={this.f.fields.email} />
          <TextField id="name" of={this.f.fields.name} />
          {/* Deliberately deeper than one level, and through a layout that knows nothing of forms. */}
          <div>
            <div>
              <SaveButton />
            </div>
          </div>
        </form>
      );
    }
  }
  const mounted = render((<Page />) as never);
  return { form, ...mounted };
}

describe("a button that watches the form", () => {
  test("it finds the form with no props, however deep it sits", () => {
    renders = {};
    const { container, unmount } = mount();
    try {
      const button = container.querySelector("#save") as HTMLButtonElement;
      // Invalid to begin with — `email` is empty — so the button starts disabled, and that is an answer
      // the form only has because it validates once at creation.
      expect(button.disabled).toBe(true);
      expect(button.textContent).toBe("Save");
    } finally {
      unmount();
    }
  });

  test("it sleeps through typing that does not change the answer", async () => {
    renders = {};
    const { form, unmount } = mount();
    try {
      renders = {};
      // `name` has no rule, so nothing about validity moves.
      await act(async () => form.fields.name.$.set("Ada"));
      expect(renders.save ?? 0).toBe(0);

      // And typing into `email` while it stays invalid — one character at a time, still invalid.
      await act(async () => form.fields.email.$.set(""));
      expect(renders.save ?? 0).toBe(0);
    } finally {
      unmount();
    }
  });

  test("but it wakes the moment validity flips, and again when it flips back", async () => {
    renders = {};
    const { form, container, unmount } = mount();
    try {
      renders = {};
      await act(async () => form.fields.email.$.set("ada@example.com"));

      expect(renders.save ?? 0).toBeGreaterThan(0);
      expect((container.querySelector("#save") as HTMLButtonElement).disabled).toBe(false);

      renders = {};
      await act(async () => form.fields.email.$.set(""));
      expect(renders.save ?? 0).toBeGreaterThan(0);
      expect((container.querySelector("#save") as HTMLButtonElement).disabled).toBe(true);
    } finally {
      unmount();
    }
  });

  test("a submit starting and ending is two changes it hears", async () => {
    let release!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    renders = {};
    const { form, container, unmount } = mount(onSubmit);
    try {
      await act(async () => form.fields.email.$.set("ada@example.com"));
      renders = {};

      await act(async () => form.submit());
      expect((container.querySelector("#save") as HTMLButtonElement).textContent).toBe("Saving…");
      const whileOut = renders.save ?? 0;
      expect(whileOut).toBeGreaterThan(0);

      await act(async () => {
        release();
      });
      expect((container.querySelector("#save") as HTMLButtonElement).textContent).toBe("Save");
      expect(renders.save ?? 0).toBeGreaterThan(whileOut);
    } finally {
      unmount();
    }
  });

  test("`isDirty` is only computed while something reads it", async () => {
    // The one expensive fact: a comparison of the whole value against the baseline. A form whose
    // watchers never ask about it must never pay for it.
    renders = {};
    const { form, unmount } = mount();
    try {
      const asked: string[] = [];
      const inner = form as unknown as { isDirtyQuietly: boolean };
      const real = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inner), "isDirtyQuietly");
      Object.defineProperty(inner, "isDirtyQuietly", {
        get() {
          asked.push("dirty");
          return real?.get?.call(this);
        },
        configurable: true,
      });

      await act(async () => form.fields.name.$.set("Ada"));

      // `SaveButton` reads `isValid` and `isSubmitting`. Nobody reads `isDirty`.
      expect(asked).toEqual([]);
    } finally {
      unmount();
    }
  });

  test("the owner can then read NOTHING off the form, and its render is built once", async () => {
    /**
     * The recipe for a form big enough to care about, and why the button had to become a component.
     *
     * A `@compute` body is cached until a signal it READ changes. Every field read inside the form
     * touches the form's counter, so a body holding `disabled={!form.isValid}` would be rebuilt on every
     * keystroke. With the fields watched by their own components and the button watching the form, the
     * body reads nothing at all — the field NODES are navigation, not reads — so it is built once and
     * the owner's render costs a cache hit for the life of the form.
     */
    renders = {};
    let built = 0;
    let form!: Form<typeof schema>;

    class Page extends Component {
      private f = this.use(Form<typeof schema>, () => ({ schema, defaultValues: EMPTY, onSubmit: () => {} }));

      @compute get body(): RamondaNode {
        built++;
        form = this.f;
        return (
          <form>
            <TextField id="email" of={this.f.fields.email} />
            <SaveButton />
          </form>
        );
      }

      render(): RamondaNode {
        count("page");
        return this.body;
      }
    }

    const { container, unmount } = render((<Page />) as never);
    try {
      expect(built).toBe(1);

      await act(async () => form.fields.email.$.set("ada@example.com"));
      await act(async () => form.fields.email.$.set(""));
      await act(async () => form.submit());

      // The owner was woken every time — it owns the form's `@state` and cannot opt out — but its body
      // was never rebuilt, so the diff had the same tree handed back to it and stopped.
      expect(built).toBe(1);
      expect(renders.page ?? 0).toBeGreaterThan(1);
      // And everything still works: the field shows its value, the button its state.
      expect((container.querySelector("#email") as HTMLInputElement).value).toBe("");
      expect((container.querySelector("#save") as HTMLButtonElement).disabled).toBe(true);
    } finally {
      unmount();
    }
  });

  test("no form above it is reported, and it does not crash", () => {
    const records: RamondaDiagnostic[] = [];
    globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    class Lonely extends Component {
      private form = this.use(FormState);
      render(): RamondaNode {
        return <button disabled={!this.form.isValid}>{this.form.submitCount}</button>;
      }
    }

    const { container, unmount } = render((<Lonely />) as never);
    try {
      // Core reports the missing provider itself — the form package writes no diagnostic for this.
      expect(records.map((record) => record.code)).toContain("RMD003");
      // And the defaults are the honest answers rather than a crash.
      expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
      expect(container.querySelector("button")?.textContent).toBe("0");
    } finally {
      globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
      spy.mockRestore();
      unmount();
    }
  });

  test("two forms nested: the inner one is the one its button watches", async () => {
    renders = {};
    let outer!: Form<typeof schema>;
    let inner!: Form<typeof schema>;

    class Inner extends Component {
      private f = this.use(Form<typeof schema>, () => ({
        schema,
        defaultValues: { email: "ada@example.com", name: "" },
        onSubmit: () => {},
      }));
      render(): RamondaNode {
        inner = this.f;
        return (
          <div>
            <SaveButton />
          </div>
        );
      }
    }

    class Outer extends Component {
      private f = this.use(Form<typeof schema>, () => ({ schema, defaultValues: EMPTY, onSubmit: () => {} }));
      render(): RamondaNode {
        outer = this.f;
        return (
          <form>
            <Inner />
          </form>
        );
      }
    }

    const { container, unmount } = render((<Outer />) as never);
    try {
      // The inner form is valid; the outer is not. The button sits inside the inner one.
      expect(outer.isValid).toBe(false);
      expect(inner.isValid).toBe(true);
      expect((container.querySelector("#save") as HTMLButtonElement).disabled).toBe(false);

      // Breaking the OUTER form must not touch it.
      renders = {};
      await act(async () => outer.fields.email.$.set(""));
      expect(renders.save ?? 0).toBe(0);
    } finally {
      unmount();
    }
  });
});
