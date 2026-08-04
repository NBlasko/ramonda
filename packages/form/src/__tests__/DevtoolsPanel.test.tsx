import { Component, state, type RamondaNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import { Form } from "../Form";
// Importing the entry is what registers the tab — the same line an app writes.
import "../devtools";
import { panelRegistry } from "../devtoolsPanel";
import type { PanelPlugin, PanelRow } from "../devtoolsPanel";
import type { StandardResult, StandardSchemaV1 } from "../types";

/**
 * What `@ramonda/devtools` renders for the Forms tab.
 *
 * The panel cannot see a hook — it is a custom element outside the tree. `Form` ANNOUNCES itself
 * with an event, `@ramonda/form/devtools` listens and describes what it heard about, and the panel
 * draws that.
 *
 * These tests import `../devtools` the way an app does, so everything they assert travels the whole
 * path: a form mounts, an event fires, the listener builds a view, the description changes. These tests hold the description still: a
 * mounted form is listed, an unmounted one is not, a broken field says what is wrong with it, and
 * the two actions do what their labels say.
 */

interface Values {
  name: string;
  email: string;
}

const schema: StandardSchemaV1<Values, Values> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const values = value as Values;
      const issues = [
        ...(values.name ? [] : [{ message: "name is required", path: ["name"] }]),
        ...(values.email.includes("@") ? [] : [{ message: "not an email", path: ["email"] }]),
      ];
      return (issues.length > 0 ? { issues } : { value: values }) as StandardResult<Values>;
    },
  },
};

const BLANK: Values = { name: "", email: "" };
const settle = () => act(async () => {});

function panel(): PanelPlugin {
  const found = panelRegistry()
    .list()
    .find((plugin) => plugin.id === "forms");
  if (!found) throw new Error("the Forms panel was not registered");
  return found;
}

const rows = (): PanelRow[] =>
  panel()
    .snapshot()
    .groups.flatMap((group) => group.rows);
const summary = (): PanelRow => rows()[0]!;
const text = (row: PanelRow): string =>
  (row.fields ?? []).map((field) => ("text" in field ? field.text : "")).join(" · ");

/** Drives a field the way a control does: through the handler `bind` puts on the element. */
function type(form: Form<typeof schema>, field: "name" | "email", value: string): void {
  const bind = form.fields[field].$.bind as { onInput: (event: Event) => void };
  bind.onInput({ target: { value, type: "text" } } as unknown as Event);
}

afterEach(() => {
  // The list is module state; a leaked form would show up in the next test's snapshot.
  expect(rows()).toEqual([]);
});

function mount(defaults: Values = BLANK) {
  let form!: Form<typeof schema>;

  class SignupForm extends Component {
    private f = this.use(Form<typeof schema>, () => ({
      schema,
      defaultValues: defaults,
      onSubmit: () => {},
    }));

    render(): RamondaNode {
      form = this.f;
      void this.f.values;
      return <form />;
    }
  }

  const mounted = render(<SignupForm />);
  return {
    ...mounted,
    get form() {
      return form;
    },
  };
}

describe("the Forms panel", () => {
  test("lists a mounted form, and stops listing an unmounted one", async () => {
    const { unmount } = mount();
    await settle();

    expect(rows().length).toBeGreaterThan(0);
    // Named after the component that owns it, which is how a reader finds it on the page.
    expect(summary().title).toBe("Form 1");

    unmount();
    expect(rows()).toEqual([]);
  });

  test("says a form is invalid, and gives each broken field its own row", async () => {
    const { unmount } = mount();
    try {
      await settle();

      expect(summary().status).toBe("error");
      expect(text(summary())).toContain("2 fields with errors");

      // A row per field that is actually wrong. A valid form is one line — this tab is for finding
      // what is broken, and a row per field would bury it.
      const broken = rows().slice(1);
      expect(broken.map((row) => row.title)).toEqual(["name", "email"]);
      expect(broken[0]!.error).toBe("name is required");
      expect(broken[0]!.status).toBe("error");
    } finally {
      unmount();
    }
  });

  test("a valid form is a single row", async () => {
    const { unmount } = mount({ name: "Ada", email: "ada@example.com" });
    try {
      await settle();

      expect(rows().length).toBe(1);
      expect(summary().status).toBe("ok");
      expect(text(summary())).toContain("valid");
    } finally {
      unmount();
    }
  });

  test("says whether a broken field has been interacted with", async () => {
    const { unmount, form } = mount();
    try {
      await settle();

      // The question people actually ask of a form: "it says this is required and I have not
      // touched it". That is `validateOn` doing its job, and saying so is quicker than deducing it.
      expect(text(rows()[1]!)).toBe("never interacted with");

      await act(async () => {
        type(form, "name", "");
      });

      expect(text(rows()[1]!)).toContain("edited");
    } finally {
      unmount();
    }
  });

  test("reset puts the form back, through the form", async () => {
    const { unmount, form } = mount();
    try {
      await settle();
      await act(async () => {
        type(form, "name", "Ada");
      });
      expect(form.values.name).toBe("Ada");

      await act(async () => {
        panel().run!(summary().id, "reset");
      });

      expect(form.values.name).toBe("");
      // Through the form, so the errors were recomputed rather than left as they were.
      expect(summary().status).toBe("error");
    } finally {
      unmount();
    }
  });

  test("submit runs the real submit, validation included", async () => {
    let submitted = 0;

    class Page extends Component {
      f = this.use(Form<typeof schema>, () => ({
        schema,
        defaultValues: { name: "Ada", email: "ada@example.com" },
        onSubmit: () => {
          submitted++;
        },
      }));

      render(): RamondaNode {
        void this.f.values;
        return <form />;
      }
    }

    const { unmount } = render(<Page />);
    try {
      await settle();
      await act(async () => {
        panel().run!(summary().id, "submit");
      });

      // The panel asks the app to do what the button does; it does not simulate it.
      expect(submitted).toBe(1);
      expect(text(summary())).toContain("1 submit");
    } finally {
      unmount();
    }
  });

  test("an action on a form that has gone says so instead of throwing", async () => {
    const { unmount } = mount();
    await settle();
    const id = summary().id;
    unmount();

    // A row is a snapshot, so the panel can always be holding one whose form has since unmounted.
    expect(panel().run!(id, "reset")).toBe("that form is no longer mounted");
  });

  test("the values are read-only, and the reason is the schema", async () => {
    const { unmount } = mount();
    try {
      await settle();

      /**
       * A form's values are the schema's INPUT side — a `Date`, a `File`, a class instance — so a
       * value typed as JSON could not be put back without lying about its type. `reset` is the
       * honest write, and it goes through the form.
       */
      expect(summary().value!.editable).toBe(false);
      expect(summary().value!.data).toEqual(BLANK);
    } finally {
      unmount();
    }
  });


  /**
   * Navigating away must not take the tab with it.
   *
   * The events carry DATA, not the tab's existence: the panel is registered once, when the entry is
   * imported, and never deregistered. So a submit that redirects, or any route change that unmounts
   * the last form, leaves the tab in place saying there are none — and the next form fills it in
   * again. A tab that appeared and disappeared as somebody moved around an app would be unusable
   * exactly when they are trying to follow something across pages.
   */
  test("a route change empties the tab but does not remove it", async () => {
    let page!: App;

    class FormPage extends Component {
      f = this.use(Form<typeof schema>, () => ({ schema, defaultValues: BLANK, onSubmit: () => {} }));
      render(): RamondaNode {
        void this.f.values;
        return <form />;
      }
    }

    class App extends Component {
      @state showing: "form" | "thanks" = "form";
      render(): RamondaNode {
        page = this;
        return this.showing === "form" ? <FormPage /> : <p>thanks</p>;
      }
    }

    // Groups rather than rows: one group is one form, and a broken form adds a row per bad field.
    const forms = () => panel().snapshot().groups.length;

    const app = render(<App />);
    try {
      await settle();
      expect(forms()).toBe(1);

      // The submit redirected.
      await act(async () => {
        page.showing = "thanks";
      });

      expect(panel()).toBeDefined();
      expect(forms()).toBe(0);
      expect(panel().snapshot().empty).toContain("No forms are mounted");

      // And back.
      await act(async () => {
        page.showing = "form";
      });
      expect(forms()).toBe(1);
    } finally {
      app.unmount();
    }
  });

  test("two forms are two groups", async () => {
    const first = mount();
    const second = mount({ name: "Ada", email: "ada@example.com" });
    try {
      await settle();

      expect(panel().snapshot().groups.length).toBe(2);
      expect(panel().snapshot().groups[1]!.rows.length).toBe(1);
    } finally {
      first.unmount();
      second.unmount();
    }
  });
});
