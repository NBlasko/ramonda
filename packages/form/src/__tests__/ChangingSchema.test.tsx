import { Component, compute, state, updated, type RamondaNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { Form } from "../Form";
import type { StandardResult, StandardSchemaV1 } from "../types";

/**
 * A schema chosen at runtime — what `/forms/validation` documents, run.
 *
 * The page makes three claims, and each is a test here: a `@compute` schema is rebuilt only when
 * what it reads moves, a new schema applies from the next validation rather than on arrival, and a
 * `submit()` in the same handler as the state change runs before the form has the new schema.
 */

interface Values {
  taxId: string;
}
type Schema = StandardSchemaV1<Values, Values>;

const personalSchema: Schema = {
  "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) as StandardResult<Values> },
};

const businessSchema: Schema = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const values = value as Values;
      return (
        values.taxId ? { value: values } : { issues: [{ message: "tax id required", path: ["taxId"] }] }
      ) as StandardResult<Values>;
    },
  },
};

const BLANK: Values = { taxId: "" };
const settle = () => act(async () => {});

describe("a schema chosen at runtime", () => {
  let page: Signup;
  let built = 0;

  class Signup extends Component {
    @state accountType: "personal" | "business" = "personal";
    @state unrelated = 0;

    @compute get schema(): Schema {
      built++;
      return this.accountType === "business" ? businessSchema : personalSchema;
    }

    form = this.use(Form<Schema>, (self: Signup) => ({
      schema: self.schema,
      defaultValues: BLANK,
      onSubmit: () => {},
    }));

    /** The shape the page marks ✗ — a submit before the form has the new schema. */
    switchAndSubmit(): void {
      this.accountType = "business";
      this.form.submit();
    }

    render(): RamondaNode {
      page = this;
      void this.unrelated;
      return <p>{this.form.isValid ? "valid" : "invalid"}</p>;
    }
  }

  const mount = () => {
    built = 0;
    const app = render(<Signup />);
    return { ...app, read: () => app.container.querySelector("p")!.textContent };
  };

  test("a @compute schema is rebuilt only when what it reads moves", async () => {
    const app = mount();
    try {
      await settle();
      const afterMount = built;

      await act(async () => {
        page.unrelated = 1;
      });

      // The reason the page says to hold it in a compute: an unrelated render must not rebuild it.
      expect(built).toBe(afterMount);

      await act(async () => {
        page.accountType = "business";
      });
      expect(built).toBeGreaterThan(afterMount);
    } finally {
      app.unmount();
    }
  });

  test("a new schema applies from the next validation, not on arrival", async () => {
    const app = mount();
    try {
      await settle();
      expect(app.read()).toBe("valid");

      await act(async () => {
        page.accountType = "business";
      });

      // Stricter rules are in place, and nothing has validated against them yet.
      expect(app.read()).toBe("valid");

      await act(async () => {
        page.form.submit();
      });
      expect(app.read()).toBe("invalid");
    } finally {
      app.unmount();
    }
  });

  test("a submit in the same handler validates against the schema being replaced", async () => {
    const app = mount();
    try {
      await settle();

      await act(async () => {
        page.switchAndSubmit();
      });

      /**
       * The ✗ example, and why it is marked as one. Writing the state schedules a render and the
       * props callback runs as part of it, so a synchronous `submit()` is ahead of the new schema
       * and passes against the old one.
       */
      expect(app.read()).toBe("valid");

      // The next one has it.
      await act(async () => {
        page.form.submit();
      });
      expect(app.read()).toBe("invalid");
    } finally {
      app.unmount();
    }
  });

  test("@updated is the answer when a toggle must show its effect at once", async () => {
    let page2: Toggle;

    class Toggle extends Component {
      @state strict = false;

      @compute get schema(): Schema {
        return this.strict ? businessSchema : personalSchema;
      }

      form = this.use(Form<Schema>, (self: Toggle) => ({
        schema: self.schema,
        defaultValues: BLANK,
        onSubmit: () => {},
      }));

      /** Runs after the commit, so the form is holding the schema this render installed. */
      @updated
      applySchema(): void {
        if (this.strict) this.form.submit();
      }

      render(): RamondaNode {
        page2 = this;
        return <p>{this.form.isValid ? "valid" : "invalid"}</p>;
      }
    }

    const app = render(<Toggle />);
    try {
      await settle();
      expect(app.container.querySelector("p")!.textContent).toBe("valid");

      await act(async () => {
        page2.strict = true;
      });

      expect(app.container.querySelector("p")!.textContent).toBe("invalid");
    } finally {
      app.unmount();
    }
  });
});
