import { Component, type RamondaNode } from "@ramonda/core";
import { render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { Form } from "../Form";
import type { StandardResult, StandardSchemaV1 } from "../types";

/**
 * A submit on an invalid form has to put the reader somewhere.
 *
 * Without this, pressing the button does nothing visible when the messages are below the fold — the
 * reader presses it again, and again. For someone using a screen reader there is no signal at all,
 * which makes this accessibility rather than polish.
 */

interface Values {
  email: string;
  nick: string;
  age: number;
}

/** Everything fails except a field whose value is the string `"ok"` (or, for age, 18). */
const schema: StandardSchemaV1<Values, Values> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const values = value as Values;
      const issues: { path: (string | number)[]; message: string }[] = [];

      if (values.email !== "ok") issues.push({ path: ["email"], message: "an email" });
      if (values.nick !== "ok") issues.push({ path: ["nick"], message: "a nickname" });
      if (Number(values.age) !== 18) issues.push({ path: ["age"], message: "eighteen" });

      const result: StandardResult<Values> = issues.length === 0 ? { value: values } : { issues };
      return result;
    },
  },
};

function mount(defaults: Values, order: (keyof Values)[] = ["email", "nick", "age"]) {
  let form!: Form<typeof schema>;

  class Page extends Component {
    private f = this.use(Form<typeof schema>, () => ({
      schema,
      defaultValues: defaults,
      onSubmit: () => {},
    }));

    render(): RamondaNode {
      form = this.f;
      const fields = this.f.fields;

      return (
        <form onsubmit={this.f.submit}>
          {order.map((name) => (
            <input key={name} {...fields[name].$.bind} />
          ))}
        </form>
      );
    }
  }

  const mounted = render((<Page />) as never);
  const formEl = mounted.container.querySelector("form") as HTMLFormElement;
  return { form, formEl, ...mounted };
}

/** What a real user does: the browser dispatches `submit` on the form. */
function pressSubmit(formEl: HTMLFormElement): void {
  formEl.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

const activeName = () => document.activeElement?.getAttribute("name") ?? null;

describe("focus after a failed submit", () => {
  test("puts the caret in the first invalid field", () => {
    const { formEl, unmount } = mount({ email: "no", nick: "no", age: 0 });
    try {
      pressSubmit(formEl);

      expect(activeName()).toBe("email");
    } finally {
      unmount();
    }
  });

  test("skips the fields that are fine", () => {
    const { formEl, unmount } = mount({ email: "ok", nick: "no", age: 0 });
    try {
      pressSubmit(formEl);

      expect(activeName()).toBe("nick");
    } finally {
      unmount();
    }
  });

  test("follows DOM order, not the order the validator reported", () => {
    // The schema always reports email, then nick, then age. On screen they are reversed, so the
    // first field the READER would reach is `age` — which is the one that has to take the caret.
    const { formEl, unmount } = mount({ email: "no", nick: "no", age: 0 }, ["age", "nick", "email"]);
    try {
      pressSubmit(formEl);

      expect(activeName()).toBe("age");
    } finally {
      unmount();
    }
  });

  test("moves nothing when the form is valid", () => {
    const { formEl, unmount } = mount({ email: "ok", nick: "ok", age: 18 });
    try {
      const before = document.activeElement;
      pressSubmit(formEl);

      expect(document.activeElement).toBe(before);
    } finally {
      unmount();
    }
  });

  test("moves nothing for a PROGRAMMATIC submit, which carries no event", () => {
    // The right boundary rather than an omission: the app called it, so the app decides where the
    // reader should be looking.
    const { form, unmount } = mount({ email: "no", nick: "no", age: 0 });
    try {
      const before = document.activeElement;
      form.submit();

      expect(document.activeElement).toBe(before);
      // The submit still happened — only the focus is the app's business.
      expect(form.submitCount).toBe(1);
      expect(form.fields.email.$.error).toBe("an email");
    } finally {
      unmount();
    }
  });

  test("skips a disabled control, which cannot take focus at all", () => {
    // `focus()` on a disabled input silently does nothing, so stopping there would leave the form
    // looking as inert as it did before the button was pressed.
    let form!: Form<typeof schema>;

    class Page extends Component {
      private f = this.use(Form<typeof schema>, () => ({
        schema,
        defaultValues: { email: "no", nick: "no", age: 0 },
        onSubmit: () => {},
      }));

      render(): RamondaNode {
        form = this.f;
        const fields = this.f.fields;
        return (
          <form onsubmit={this.f.submit}>
            <input {...fields.email.$.bind} disabled />
            <input {...fields.nick.$.bind} />
          </form>
        );
      }
    }

    const mounted = render((<Page />) as never);
    try {
      pressSubmit(mounted.container.querySelector("form") as HTMLFormElement);

      expect(activeName()).toBe("nick");
      expect(form.submitCount).toBe(1);
    } finally {
      mounted.unmount();
    }
  });

  test("stays inside the form it was submitted from", () => {
    // Two forms on one page. Focus must not land in the other one, which is what a document-wide
    // query would have done.
    //
    // ONE form per component, which is the only arrangement there is: a component publishes a
    // context on one object, so a second Form on the same one is refused (RMD056). It costs nothing
    // here and it is what an app writes anyway — each form owns its own piece of markup.
    class OneForm extends Component<{ id: string; input: string }> {
      private form = this.use(Form<typeof schema>, () => ({
        schema,
        defaultValues: { email: "no", nick: "no", age: 0 },
        onSubmit: () => {},
      }));

      render(): RamondaNode {
        return (
          <form id={this.props.id} onsubmit={this.form.submit}>
            <input id={this.props.input} {...this.form.fields.email.$.bind} />
          </form>
        );
      }
    }

    class Page extends Component {
      render(): RamondaNode {
        return (
          <div>
            <OneForm id="first" input="a" />
            <OneForm id="second" input="b" />
          </div>
        );
      }
    }

    const mounted = render((<Page />) as never);
    try {
      const second = mounted.container.querySelector("#second") as HTMLFormElement;
      pressSubmit(second);

      // Both inputs are named `email`; only the one in the submitted form may take the caret.
      expect(document.activeElement?.id).toBe("b");
    } finally {
      mounted.unmount();
    }
  });

  test("still finds the field when the schema answered LATE", async () => {
    // An async schema answers long after dispatch is over, by which point `currentTarget` is null.
    // The element is captured synchronously in `submit` so the answer still has somewhere to look.
    //
    // Holding the event and reading it late passes this too, because `scopeOf` falls back to
    // `target` — measured, so the capture is not what makes this case work. What it buys is the
    // RIGHT element: `currentTarget` is where the handler was attached, and the two differ whenever
    // it sits on an ancestor.
    interface Slow {
      email: string;
    }

    const slowSchema: StandardSchemaV1<Slow, Slow> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: async (value) => {
          await Promise.resolve();
          const values = value as Slow;
          const result: StandardResult<Slow> =
            values.email === "ok" ? { value: values } : { issues: [{ path: ["email"], message: "an email" }] };
          return result;
        },
      },
    };

    class Page extends Component {
      private f = this.use(Form<typeof slowSchema>, () => ({
        schema: slowSchema,
        defaultValues: { email: "no" },
        onSubmit: () => {},
      }));

      render(): RamondaNode {
        return (
          <form onsubmit={this.f.submit}>
            <input {...this.f.fields.email.$.bind} />
          </form>
        );
      }
    }

    const mounted = render((<Page />) as never);
    try {
      pressSubmit(mounted.container.querySelector("form") as HTMLFormElement);

      // Nothing yet — the schema has not answered.
      expect(activeName()).toBeNull();

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(activeName()).toBe("email");
    } finally {
      mounted.unmount();
    }
  });

  test("reaches a field inside an array row", () => {
    interface Listy {
      rows: string[];
    }

    const listSchema: StandardSchemaV1<Listy, Listy> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value) => {
          const values = value as Listy;
          const issues = values.rows.flatMap((row, index) =>
            row === "" ? [{ path: ["rows", index], message: "not blank" }] : [],
          );
          const result: StandardResult<Listy> = issues.length === 0 ? { value: values } : { issues };
          return result;
        },
      },
    };

    class Page extends Component {
      private f = this.use(Form<typeof listSchema>, () => ({
        schema: listSchema,
        defaultValues: { rows: ["fine", ""] },
        onSubmit: () => {},
      }));

      render(): RamondaNode {
        return (
          <form onsubmit={this.f.submit}>
            <input {...this.f.fields.rows[0].$.bind} />
            <input {...this.f.fields.rows[1].$.bind} />
          </form>
        );
      }
    }

    const mounted = render((<Page />) as never);
    try {
      pressSubmit(mounted.container.querySelector("form") as HTMLFormElement);

      // The bracketed name has to survive the round trip through `parsePath`.
      expect(activeName()).toBe("rows[1]");
    } finally {
      mounted.unmount();
    }
  });
});
