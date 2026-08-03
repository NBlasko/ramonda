import { Component, type RamondaNode, state } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { Form } from "../Form";
import type { StandardResult, StandardSchemaV1 } from "../types";

/**
 * `defaultValues` arriving after the form exists — "fetch the record, then fill it in".
 *
 * This did not work at all. `current` latched the defaults on its first read, which is `prime()`, and
 * never looked at the prop for values again: a form handed `{ name: "Ada" }` a moment after mounting
 * went on showing the empty strings it started with, and nothing reported it.
 *
 * The rule now is the one anyone asking for this wants — an untouched field takes the new value, an
 * edited one keeps what was typed — so the tests below are that matrix: (edited / untouched) ×
 * (scalar / nested / array) × (a new value / the same one).
 *
 * Every form here is built from a props FACTORY. It has to be: a props LITERAL is evaluated once at
 * construction, so the defaults could never move through one, and the first attempt to measure this
 * measured nothing for exactly that reason.
 */
interface Values {
  name: string;
  email: string;
  address: { street: string; city: string };
  tags: string[];
  contacts: { kind: string; value: string }[];
}

const EMPTY: Values = { name: "", email: "", address: { street: "", city: "" }, tags: [], contacts: [] };

/** Reports on an empty `name`, so a message can be watched as the defaults move under it. */
const schema: StandardSchemaV1<Values, Values> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const values = value as Values;
      const result: StandardResult<Values> =
        values.name === "" ? { issues: [{ path: ["name"], message: "a name is required" }] } : { value: values };
      return result;
    },
  },
};

/**
 * A page whose defaults are STATE, which is what a fetch landing into a component looks like.
 *
 * `renders` counts the owner's passes and `baseline` says what an ORDINARY state write on the same
 * component would have left it at — measured here by nudging an unrelated field, because the number
 * itself belongs to the harness. Asserting `renders === baseline` after new defaults land therefore
 * says one thing only: the form added no pass of its own. That is the loop this design has to avoid,
 * since the props factory hands over a fresh object every time it runs.
 */
function mount(initial: Values = EMPTY) {
  let form!: Form<typeof schema>;
  let page!: Page;

  class Page extends Component {
    @state defaults: Values = initial;
    @state nudge = 0;
    renders = 0;
    baseline = 0;

    private f = this.use(Form<typeof schema>, (self: Page) => ({
      schema,
      defaultValues: self.defaults,
      onSubmit: (_values: Values) => {},
    }));

    render(): RamondaNode {
      form = this.f;
      page = this;
      void this.nudge;
      this.renders++;
      return <form />;
    }
  }

  const mounted = render((<Page />) as never);

  const before = page.renders;
  act(() => {
    page.nudge++;
  });
  const perWrite = page.renders - before;

  /** Hands the form a new record, the way a landed fetch does. */
  const arrive = (values: Values) => {
    page.baseline = page.renders + perWrite;
    act(() => {
      page.defaults = values;
    });
  };

  return {
    form,
    get page() {
      return page;
    },
    arrive,
    ...mounted,
  };
}

describe("defaults that arrive late", () => {
  test("an untouched field takes the new value", () => {
    const { form, arrive, unmount } = mount();
    try {
      arrive({ ...EMPTY, name: "Ada", email: "ada@example.com" });

      expect(form.values.name).toBe("Ada");
      expect(form.values.email).toBe("ada@example.com");
    } finally {
      unmount();
    }
  });

  test("an edited field keeps what was typed, and its untouched neighbour still updates", () => {
    // The failure this is designed against: somebody is halfway through typing when the request
    // comes back. The reported defect had the opposite failure — BOTH were kept, so the fetch was
    // lost entirely.
    const { form, arrive, unmount } = mount();
    try {
      form.fields.name.$.set("typed by user");
      arrive({ ...EMPTY, name: "FETCHED name", email: "fetched@example.com" });

      expect(form.values.name).toBe("typed by user");
      expect(form.values.email).toBe("fetched@example.com");
    } finally {
      unmount();
    }
  });

  test("a field that was blurred but never typed in is not the user's", () => {
    // `touchedKeys` means BLURRED. Tabbing through a field leaves nothing of theirs to protect, so
    // the decision is `changedKeys` — and this is the case that separates the two.
    const { form, arrive, unmount } = mount();
    try {
      form.fields.email.$.bind.onBlur(new Event("blur"));
      arrive({ ...EMPTY, email: "fetched@example.com" });

      expect(form.values.email).toBe("fetched@example.com");
    } finally {
      unmount();
    }
  });

  test("a nested field is decided on its own, not by its parent", () => {
    // The reason an object is always walked rather than tested for ownership as a whole: a form
    // where one field was edited has a ROOT that differs from its defaults, so asking the question
    // at the top would answer "the user owns everything" and adopt nothing.
    const { form, arrive, unmount } = mount();
    try {
      form.fields.address.street.$.set("Typed Street");
      arrive({ ...EMPTY, address: { street: "Fetched Street", city: "Fetched City" } });

      expect(form.values.address.street).toBe("Typed Street");
      expect(form.values.address.city).toBe("Fetched City");
    } finally {
      unmount();
    }
  });

  test("a key the new defaults add arrives, even though the form does not hold it", () => {
    const { form, arrive, unmount } = mount({ ...EMPTY, address: {} as Values["address"] });
    try {
      arrive({ ...EMPTY, address: { street: "New Street", city: "New City" } });

      expect(form.values.address).toEqual({ street: "New Street", city: "New City" });
    } finally {
      unmount();
    }
  });

  test("defaults that are equal by value change nothing at all", () => {
    // A props factory builds a fresh object every time it runs, so `@watchProp` fires on every
    // render of the owner. If that produced a state write, the form would re-render the owner, which
    // would run the factory again — a loop. It is answered by VALUE before anything is written.
    const { form, page, arrive, unmount } = mount({ ...EMPTY, name: "Ada" });
    try {
      const values = form.values;
      arrive({ ...EMPTY, name: "Ada" });

      // The very same object: nothing was rebuilt, so nothing downstream sees a change either.
      expect(form.values).toBe(values);
      expect(page.renders).toBe(page.baseline);
    } finally {
      unmount();
    }
  });

  test("adopting new defaults costs no render of its own", () => {
    // `@watchProp` runs BEFORE the render, so the write joins the pass already in flight instead of
    // scheduling a second one. Compared against an unrelated state write on the same component
    // rather than against a number, because the number is the harness's and would only be asserting
    // how many passes a `@state` write costs here.
    const { page, arrive, unmount } = mount();
    try {
      arrive({ ...EMPTY, name: "Ada", email: "ada@example.com" });

      expect(page.renders).toBe(page.baseline);
    } finally {
      unmount();
    }
  });
});

describe("defaults that arrive late, and arrays", () => {
  test("an untouched array takes the new rows", () => {
    const { form, arrive, unmount } = mount();
    try {
      arrive({ ...EMPTY, tags: ["red", "green"] });

      expect(form.values.tags).toEqual(["red", "green"]);
      expect(form.fields.tags.$.rows).toHaveLength(2);
    } finally {
      unmount();
    }
  });

  test("rows that survive a longer set of defaults keep their identities", () => {
    // `rowIds` tops up and trims rather than renumbering, so an array replaced wholesale reuses the
    // elements it can. The caret and any selection inside a surviving row go with them.
    const { form, arrive, unmount } = mount({ ...EMPTY, tags: ["one"] });
    try {
      const before = form.fields.tags.$.rows.map((row) => row.id);

      arrive({ ...EMPTY, tags: ["ONE", "two", "three"] });
      const after = form.fields.tags.$.rows.map((row) => row.id);

      expect(after[0]).toBe(before[0]);
      expect(new Set(after).size).toBe(3);
      expect(form.values.tags).toEqual(["ONE", "two", "three"]);
    } finally {
      unmount();
    }
  });

  test("an array the user added a row to is theirs, and the new defaults do not touch it", () => {
    // `splice` records nothing in `changedKeys` — it clears what was under the path instead. So the
    // structural edit is caught by the value having moved away from the defaults it was built from,
    // which is the second half of the leaf test.
    const { form, arrive, unmount } = mount({ ...EMPTY, tags: ["kept"] });
    try {
      form.fields.tags.$.append("added by user");

      arrive({ ...EMPTY, tags: ["fetched"] });

      expect(form.values.tags).toEqual(["kept", "added by user"]);
    } finally {
      unmount();
    }
  });

  test("an array the user reordered is theirs too", () => {
    const { form, arrive, unmount } = mount({ ...EMPTY, tags: ["a", "b"] });
    try {
      form.fields.tags.$.move(0, 1);

      arrive({ ...EMPTY, tags: ["x", "y"] });

      expect(form.values.tags).toEqual(["b", "a"]);
    } finally {
      unmount();
    }
  });

  test("rows of the same length merge per row, so one edited row does not hold the rest back", () => {
    const { form, arrive, unmount } = mount({
      ...EMPTY,
      contacts: [
        { kind: "email", value: "" },
        { kind: "phone", value: "" },
      ],
    });
    try {
      form.fields.contacts[0].value.$.set("typed@example.com");

      arrive({
        ...EMPTY,
        contacts: [
          { kind: "email", value: "fetched@example.com" },
          { kind: "phone", value: "555-0100" },
        ],
      });

      expect(form.values.contacts).toEqual([
        { kind: "email", value: "typed@example.com" },
        { kind: "phone", value: "555-0100" },
      ]);
    } finally {
      unmount();
    }
  });

  test("a length that changed makes the array a leaf rather than pairing rows by number", () => {
    // Row 1 was edited, then the fetch brings ONE row. Merging by index would put the user's second
    // row's text onto whatever now sits at that number — or drop it — and either way the ids and the
    // values would be describing different rows. Whole-array, and the user's wins.
    const { form, arrive, unmount } = mount({ ...EMPTY, tags: ["a", "b"] });
    try {
      form.fields.tags[1].$.set("typed");

      arrive({ ...EMPTY, tags: ["only"] });

      expect(form.values.tags).toEqual(["a", "typed"]);
    } finally {
      unmount();
    }
  });
});

describe("the comparison is the form's own, and unbounded", () => {
  test("a row past the framework's comparison width still arrives", () => {
    /**
     * Why `Form` does NOT declare `@StableProps("defaultValues")`.
     *
     * The declaration is right for `Query.key` and it looks right here: it would hand back one
     * identity while the contents are equal, and `@watchProp` would not even fire. But the
     * comparison behind it is bounded — five levels deep, and anything wider than fifty items is
     * called different rather than compared. A form's defaults are routinely past both, so the
     * declaration would quietly stop helping.
     *
     * The width bound errs that way BECAUSE of this test. It used to compare the first fifty items
     * and answer "equal" for the rest, so with the declaration in place a record whose only change
     * was row 55 of 60 came back as the previous object, `@watchProp` never fired, and the value
     * was lost with nothing reported. Core answers "different" past the width now.
     *
     * The form still compares its own defaults in full, and that stands on its own: deciding per
     * field who owns what needs the whole walk anyway.
     */
    const row = (n: number, at: number, what: string) =>
      Array.from({ length: n }, (_, i) => (i === at ? what : `r${i}`));

    const { form, arrive, unmount } = mount({ ...EMPTY, tags: row(60, -1, "") });
    try {
      arrive({ ...EMPTY, tags: row(60, 55, "past the width") });

      expect(form.values.tags[55]).toBe("past the width");
    } finally {
      unmount();
    }
  });
});

describe("what the form says about itself afterwards", () => {
  test("it revalidates, so `isValid` is about the values it now holds", () => {
    const { form, arrive, unmount } = mount();
    try {
      expect(form.isValid).toBe(false);

      arrive({ ...EMPTY, name: "Ada" });

      // Without the revalidation this would still be reporting on the empty form.
      expect(form.isValid).toBe(true);
    } finally {
      unmount();
    }
  });

  test("an untouched field that took a new value is not dirty", () => {
    const { form, arrive, unmount } = mount();
    try {
      arrive({ ...EMPTY, name: "Ada" });

      // `dirtyAt` compares against `props.defaultValues`, which is the new record — and the field
      // holds exactly it.
      expect(form.fields.name.$.dirty).toBe(false);
      expect(form.isDirty).toBe(false);
    } finally {
      unmount();
    }
  });

  test("an edited field is still dirty against the new defaults", () => {
    const { form, arrive, unmount } = mount();
    try {
      form.fields.name.$.set("typed by user");
      arrive({ ...EMPTY, name: "Ada" });

      expect(form.fields.name.$.dirty).toBe(true);
      expect(form.isDirty).toBe(true);
    } finally {
      unmount();
    }
  });

  test("a message about the old value does not survive the value", () => {
    const { form, arrive, unmount } = mount();
    try {
      // Blur it so `errorsAt` will actually show what the schema found.
      form.fields.name.$.bind.onBlur(new Event("blur"));
      expect(form.fields.name.$.errors).toEqual(["a name is required"]);

      arrive({ ...EMPTY, name: "Ada" });

      expect(form.fields.name.$.errors).toEqual([]);
      expect(form.fields.name.$.touched).toBe(false);
    } finally {
      unmount();
    }
  });

  test("a field reset after the defaults moved is adoptable again", () => {
    // The other half of the same question `reset` answers. Without the baseline moving too, the
    // field would sit at the default it was just reset to while the comparison still held the one
    // before it — so it would read as the user's from then on, and never take another default.
    const { form, arrive, unmount } = mount();
    try {
      form.fields.email.$.set("typed by user");
      arrive({ ...EMPTY, email: "first@example.com" });
      expect(form.values.email).toBe("typed by user");

      form.fields.email.$.reset();
      expect(form.values.email).toBe("first@example.com");

      arrive({ ...EMPTY, email: "second@example.com" });
      expect(form.values.email).toBe("second@example.com");
    } finally {
      unmount();
    }
  });

  test("a reset makes the whole form adoptable again", () => {
    // `reset(record)` puts values in that nobody typed, so defaults arriving afterwards are free to
    // take every field. Measuring "untouched" against `props.defaultValues` instead would mark such
    // a form as edited everywhere and let nothing in ever again.
    const { form, arrive, unmount } = mount();
    try {
      form.fields.name.$.set("typed by user");
      form.reset({ ...EMPTY, name: "from a reset" });

      arrive({ ...EMPTY, name: "Ada" });

      expect(form.values.name).toBe("Ada");
    } finally {
      unmount();
    }
  });

  test("the panel shows the values it now holds", () => {
    const { form, arrive, unmount } = mount();
    try {
      arrive({ ...EMPTY, name: "Ada" });

      const detail = form[Symbol.for("ramonda.inspect") as never] as unknown as () => Record<string, unknown>;
      expect((detail.call(form).values as Values).name).toBe("Ada");
    } finally {
      unmount();
    }
  });
});
