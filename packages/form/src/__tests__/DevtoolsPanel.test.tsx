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

function mount(defaults: Values = BLANK, label?: string) {
  let form!: Form<typeof schema>;

  class SignupForm extends Component {
    private f = this.use(Form<typeof schema>, () => ({
      schema,
      defaultValues: defaults,
      onSubmit: () => {},
      label,
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
    // Numbered, because a form with no `label` has no name to go by: a hook cannot see the component
    // that used it. The number is the order it mounted in, and it is asserted as a shape rather than
    // as a value — the counter runs for the whole session, so a case added above this one would move
    // it.
    expect(summary().title).toMatch(/^Form \d+$/);

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

  /**
   * The fault this closes: a broken field's row sat as a SIBLING of the summary above it, so with
   * two forms on a page the second form's `email` read as if it belonged to the first. The rows were
   * grouped in the data all along — the group just had nothing on it to draw.
   */
  test("with two forms, each group says which form its rows belong to", async () => {
    // The first is invalid, so it has field rows under it; the second is valid and is one line.
    const broken = mount();
    const valid = mount({ name: "Ada", email: "ada@example.com" });
    try {
      await settle();
      const groups = panel().snapshot().groups;

      // Not the literal numbers: a form's id is minted from a counter that runs for the whole
      // session, so by this point in the file it is at whatever the earlier cases left it. What
      // matters is that each group is labelled, the two differ, and each label names the form whose
      // summary row sits directly beneath it — which is what makes the frame trustworthy rather
      // than decorative.
      const labels = groups.map((group) => group.label);
      expect(labels.every((label) => typeof label === "string" && label.length > 0)).toBe(true);
      expect(new Set(labels).size).toBe(2);
      for (const group of groups) {
        expect(group.rows[0]!.title).toBe(group.label);
      }
    } finally {
      broken.unmount();
      valid.unmount();
    }
  });

  test("a form given a `label` is called that, everywhere the panel names it", async () => {
    // The escape hatch for the case a number cannot answer: two forms, and a reader who wants to know
    // which is the signup.
    const signup = mount(BLANK, "signup");
    const login = mount({ name: "Ada", email: "ada@example.com" }, "login");
    try {
      await settle();
      const groups = panel().snapshot().groups;

      // The class and the label, not one instead of the other: a tab of `signup` and `login` would no
      // longer say either of them is a form, and the component tree names hooks the same way.
      expect(groups.map((group) => group.label)).toEqual(["Form (signup)", "Form (login)"]);
      expect(groups.map((group) => group.rows[0]!.title)).toEqual(["Form (signup)", "Form (login)"]);
      // And the run message speaks the same name back, which is the other place it is read.
      expect(panel().run!(groups[0]!.rows[0]!.id, "reset")).toBe("reset Form (signup)");
    } finally {
      signup.unmount();
      login.unmount();
    }
  });

  /**
   * The case the announce event could not serve, and the reason the label is read live.
   *
   * A label may be computed in the props callback, which re-runs when the signals it reads move. An
   * event fires once, at mount, so a name taken from it would be the name the form had when it
   * appeared while every other field in the tab was current — one frozen field among live ones.
   */
  test("a label computed in the props callback follows the signal it reads", async () => {
    let bump!: () => void;

    class Orders extends Component {
      @state which = "first";
      private f = this.use(Form<typeof schema>, (self: Orders) => ({
        schema,
        defaultValues: BLANK,
        onSubmit: () => {},
        label: `order ${self.which}`,
      }));

      render(): RamondaNode {
        bump = () => {
          this.which = "second";
        };
        void this.f.values;
        return <form />;
      }
    }

    const mounted = render(<Orders />);
    try {
      await settle();
      expect(panel().snapshot().groups[0]!.rows[0]!.title).toBe("Form (order first)");

      bump();
      await settle();

      // The tab reads the label the way it reads values and errors — through the instance, now.
      expect(panel().snapshot().groups[0]!.rows[0]!.title).toBe("Form (order second)");
    } finally {
      mounted.unmount();
    }
  });

  test("a blank label is no label, so the number still answers", async () => {
    const only = mount(BLANK, "   ");
    try {
      await settle();
      expect(panel().snapshot().groups[0]!.rows[0]!.title).toMatch(/^Form \d+$/);
    } finally {
      only.unmount();
    }
  });

  test("one form has no label, because a header over the only group says nothing", async () => {
    const only = mount();
    try {
      await settle();
      const groups = panel().snapshot().groups;

      expect(groups).toHaveLength(1);
      expect(groups[0]!.label).toBeUndefined();
      // The rows are still there; it is the frame that is absent, not the content.
      expect(groups[0]!.rows.length).toBeGreaterThan(1);
    } finally {
      only.unmount();
    }
  });
});
