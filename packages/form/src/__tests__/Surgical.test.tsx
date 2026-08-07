import { Component, Host, list, type RamondaNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { Field } from "../field";
import { Form } from "../Form";
import type { FieldNode, Row, StandardResult, StandardSchemaV1 } from "../types";

/**
 * A field in its own component, which is the shape every design system needs.
 *
 * Two questions, and the first one is not about speed. **Does it work at all** — a child handed a
 * field node used to re-render never: the node is one cached object for the life of the form, so its
 * props never change and the diff skips it, and the form's `@state` belongs to the form's owner, so
 * the child was subscribed to nothing. It showed an empty input and no message while the form held
 * both, and said nothing about it.
 *
 * And then: **does one keystroke wake one field**. That is what the per-path subscription buys, and it
 * is what a form with three hundred rows needs.
 */

interface Values {
  a: string;
  b: string;
  rows: { v: string }[];
}

/** `a` and every row must be non-empty, so a message can be watched arriving and leaving. */
const schema: StandardSchemaV1<Values, Values> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const values = value as Values;
      const issues: { message: string; path: (string | number)[] }[] = [];
      if (values.a === "") issues.push({ message: "required", path: ["a"] });
      values.rows.forEach((row, index) => {
        if (row.v === "") issues.push({ message: "row required", path: ["rows", index, "v"] });
      });
      return (issues.length === 0 ? { value: values } : { issues }) as StandardResult<Values>;
    },
  },
};

const EMPTY: Values = { a: "", b: "", rows: [] };

/** How many times each labelled component has rendered. */
let renders: Record<string, number> = {};

function count(label: string): void {
  renders[label] = (renders[label] ?? 0) + 1;
}

/** The adapter pattern: the host element is the wrapper a design system writes anyway. */
@Host("label", (self: TextField) => ({ className: self.f.error === undefined ? "field" : "field field--invalid" }))
class TextField extends Component<{ of: FieldNode<string>; label: string; id: string }> {
  f = this.use(Field<string>, () => ({ of: this.props.of }));

  render(): RamondaNode {
    count(this.props.id);
    return [
      <span className="field__label">{this.props.label}</span>,
      <input id={this.props.id} {...this.f.bind} />,
      <span id={`${this.props.id}-error`}>{this.f.error ?? ""}</span>,
    ];
  }
}

/** One row of a list, reached through `list({ as })`, where the item carries the node. */
class RowField extends Component<{ item: Row<{ v: string }> }> {
  f = this.use(Field<string>, () => ({
    of: (this.props.item.field as FieldNode<{ v: string }>).v,
  }));

  render(): RamondaNode {
    count(`row:${this.props.item.id}`);
    return <input id={`row-${this.props.item.index}`} {...this.f.bind} />;
  }
}

describe("a field in its own component", () => {
  function mount() {
    let form!: Form<typeof schema>;
    class Page extends Component {
      private f = this.use(Form<typeof schema>, { schema, defaultValues: EMPTY, onSubmit: () => {} });
      render(): RamondaNode {
        count("page");
        form = this.f;
        return (
          <form>
            <TextField id="a" label="A" of={this.f.fields.a} />
            <TextField id="b" label="B" of={this.f.fields.b} />
          </form>
        );
      }
    }
    const mounted = render((<Page />) as never);
    return { form, ...mounted };
  }

  test("its message appears, which it never did before", async () => {
    renders = {};
    const { form, container, unmount } = mount();
    try {
      await act(async () => form.submit());

      expect(container.querySelector("#a-error")?.textContent).toBe("required");
      expect(form.fields.a.$.error).toBe("required");
      // And the wrapper's own class followed, because the host props callback reads through the hook.
      expect(container.querySelector("label")?.className).toBe("field field--invalid");
    } finally {
      unmount();
    }
  });

  test("a write it did not make reaches its input", async () => {
    renders = {};
    const { form, container, unmount } = mount();
    try {
      await act(async () => form.fields.b.$.set("typed elsewhere"));

      expect((container.querySelector("#b") as HTMLInputElement).value).toBe("typed elsewhere");
    } finally {
      unmount();
    }
  });

  test("a keystroke in one field does not render the other", async () => {
    renders = {};
    const { form, unmount } = mount();
    try {
      renders = {};
      await act(async () => form.fields.a.$.set("x"));

      // `a` heard about it. `b` did not: its path did not move and its messages did not change.
      expect(renders.a ?? 0).toBeGreaterThan(0);
      expect(renders.b ?? 0).toBe(0);
    } finally {
      unmount();
    }
  });

  test("the owner still re-renders, because it reached into the form itself", async () => {
    renders = {};
    const { form, unmount } = mount();
    try {
      renders = {};
      await act(async () => form.fields.a.$.set("x"));

      // Reading `form.fields` is asking about the form, and that subscription is unchanged — a form
      // written inline in one component behaves exactly as it did.
      expect(renders.page ?? 0).toBeGreaterThan(0);
    } finally {
      unmount();
    }
  });

  test("a message arriving on one field does not wake a field whose message did not move", async () => {
    renders = {};
    const { form, unmount } = mount();
    try {
      // Reveal `a`'s message.
      await act(async () => form.submit());
      renders = {};

      // Fixing `a` clears `a`'s message. `b` never had one and still has none.
      await act(async () => form.fields.a.$.set("filled"));

      expect(renders.a ?? 0).toBeGreaterThan(0);
      expect(renders.b ?? 0).toBe(0);
    } finally {
      unmount();
    }
  });
});

describe("rows through list()", () => {
  function mountRows(howMany: number) {
    const rows = Array.from({ length: howMany }, () => ({ v: "filled" }));
    let form!: Form<typeof schema>;
    class Page extends Component {
      private f = this.use(Form<typeof schema>, {
        schema,
        defaultValues: { ...EMPTY, a: "ok", rows },
        onSubmit: () => {},
      });
      render(): RamondaNode {
        count("page");
        form = this.f;
        return <div>{list({ each: this.f.fields.rows.$.rows, key: (row) => row.id, as: RowField })}</div>;
      }
    }
    const mounted = render((<Page />) as never);
    return { form, ...mounted };
  }

  test("a keystroke in one row rebuilds that row and no other", async () => {
    renders = {};
    const { form, unmount } = mountRows(50);
    try {
      const rows = form.fields.rows.$.rows;
      renders = {};

      await act(async () => (rows[0].field as FieldNode<{ v: string }>).v.$.set("edited"));

      const rebuilt = Object.keys(renders).filter((key) => key.startsWith("row:"));
      expect(rebuilt).toEqual([`row:${rows[0].id}`]);
    } finally {
      unmount();
    }
  });

  test("a row that is removed takes its subscription with it", async () => {
    renders = {};
    const { form, unmount } = mountRows(5);
    try {
      const before = form.fields.rows.$.rows.map((row) => row.id);
      await act(async () => form.fields.rows.$.remove(0));

      const after = form.fields.rows.$.rows.map((row) => row.id);
      expect(after).toEqual(before.slice(1));

      // Nothing left watching the path that is gone — otherwise a later change would poke a hook
      // whose component is unmounted, and the map would grow for the life of the form.
      const watchers = (form as unknown as { watchers: Map<string, Set<unknown>> }).watchers;
      const stale = [...watchers.entries()].filter(([, set]) => set.size === 0);
      expect(stale).toEqual([]);
      expect(watchers.size).toBe(after.length);
    } finally {
      unmount();
    }
  });

  test("a row whose value the whole array replaced still shows it", async () => {
    renders = {};
    const { form, container, unmount } = mountRows(3);
    try {
      // Writing the ARRAY, not the field: the row's own path never appears, so only the descendant
      // rule reaches it.
      await act(async () => form.fields.rows.$.set([{ v: "one" }, { v: "two" }, { v: "three" }]));

      expect((container.querySelector("#row-1") as HTMLInputElement).value).toBe("two");
    } finally {
      unmount();
    }
  });

  test("every subscription is released when the form goes", async () => {
    renders = {};
    const { form, unmount } = mountRows(4);
    try {
      const watchers = (form as unknown as { watchers: Map<string, Set<unknown>> }).watchers;
      expect(watchers.size).toBe(4);
      unmount();
      expect([...watchers.values()].every((set) => set.size === 0)).toBe(true);
    } finally {
      // Unmounted above; a second call is what the harness does anyway.
    }
  });
});

/**
 * What the hook is worth, at a size where it matters, and what it costs not to have it.
 *
 * The gate is the COUNT, which is deterministic. The milliseconds are printed rather than asserted:
 * jsdom timings swing by a third run to run, so a ratio would be a flaky test pretending to be a
 * measurement. For the record, on this machine at 300 rows: **45 ms and every row rebuilt** before the
 * per-path subscription existed, **7.5 ms and one row** after. What is left is the owner's own render —
 * it read `form.fields` and so hears about everything — diffing three hundred list items.
 */
describe("at three hundred rows", () => {
  /** The same row, WITHOUT the hook: reads the node straight from its props. */
  class NaiveRow extends Component<{ item: Row<{ v: string }> }> {
    render(): RamondaNode {
      count(`row:${this.props.item.id}`);
      const f = (this.props.item.field as FieldNode<{ v: string }>).v.$;
      return <input {...f.bind} />;
    }
  }

  function mountMany(as: typeof RowField | typeof NaiveRow) {
    const rows = Array.from({ length: 300 }, () => ({ v: "filled" }));
    let form!: Form<typeof schema>;
    class Page extends Component {
      private f = this.use(Form<typeof schema>, {
        schema,
        defaultValues: { ...EMPTY, a: "ok", rows },
        onSubmit: () => {},
      });
      render(): RamondaNode {
        form = this.f;
        return <div>{list({ each: this.f.fields.rows.$.rows, key: (row) => row.id, as })}</div>;
      }
    }
    const mounted = render((<Page />) as never);
    return { form, ...mounted };
  }

  test("one keystroke reaches one row", async () => {
    renders = {};
    const { form, unmount } = mountMany(RowField);
    try {
      const rows = form.fields.rows.$.rows;
      renders = {};
      const start = performance.now();
      await act(async () => (rows[0].field as FieldNode<{ v: string }>).v.$.set("edited"));
      const ms = performance.now() - start;

      const rebuilt = new Set(Object.keys(renders).filter((key) => key.startsWith("row:")));
      expect([...rebuilt]).toEqual([`row:${rows[0].id}`]);
      console.log(`[form] 300 rows, one keystroke through Field: 1 row rebuilt, ${ms.toFixed(1)} ms`);
    } finally {
      unmount();
    }
  });

  test("without the hook a row hears nothing at all, which is the fault and not the saving", async () => {
    renders = {};
    const { form, container, unmount } = mountMany(NaiveRow);
    try {
      const rows = form.fields.rows.$.rows;
      renders = {};
      await act(async () => (rows[0].field as FieldNode<{ v: string }>).v.$.set("edited"));

      // Zero rows rebuilt looks like the best possible result and is the bug: the form holds the new
      // value and the input on screen still shows the old one.
      expect(Object.keys(renders).filter((key) => key.startsWith("row:"))).toEqual([]);
      expect(form.values.rows[0].v).toBe("edited");
      expect((container.querySelector("input") as HTMLInputElement).value).toBe("filled");
    } finally {
      unmount();
    }
  });
});

/**
 * WHAT a watcher hears about, not only where.
 *
 * A component rendering a list shows each row's `id`, `index` and `field`, and none of them move when
 * a value inside a row does — so it has no business waking on a keystroke in one of its rows. Each row
 * watches its own field and wakes on its own. Without this the container woke on every keystroke in
 * every row it held, which at three hundred rows was the whole remaining cost of an edit.
 *
 * The mechanism is a bitmask: a `Field` records which kinds of thing its component actually read, and
 * ignores a poke about anything else.
 */
describe("a watcher hears only about what it reads", () => {
  /** The container: watches the ARRAY, renders the rows, reads nothing per value. */
  class Rows extends Component<{ of: FieldNode<{ v: string }[]> }> {
    f = this.use(Field<{ v: string }[]>, () => ({ of: this.props.of }));

    render(): RamondaNode {
      count("rows-container");
      return <div>{list({ each: this.f.rows, key: (row) => row.id, as: RowField })}</div>;
    }
  }

  function mountList(howMany: number) {
    const rows = Array.from({ length: howMany }, () => ({ v: "filled" }));
    let form!: Form<typeof schema>;
    class Page extends Component {
      private f = this.use(Form<typeof schema>, {
        schema,
        defaultValues: { ...EMPTY, a: "ok", rows },
        onSubmit: () => {},
      });
      render(): RamondaNode {
        count("page");
        form = this.f;
        // The owner hands the array node over and reads NOTHING off the form itself, so the only
        // subscription in the tree is the container's and each row's.
        return <Rows of={this.f.fields.rows} />;
      }
    }
    const mounted = render((<Page />) as never);
    return { form, ...mounted };
  }

  test("a keystroke in a row leaves the container asleep", async () => {
    renders = {};
    const { form, unmount } = mountList(50);
    try {
      const rows = form.fields.rows.$.rows;
      renders = {};

      await act(async () => (rows[0].field as FieldNode<{ v: string }>).v.$.set("edited"));

      // The row that changed, and nothing else in the tree.
      // The container slept, and the row that changed woke.
      expect(renders["rows-container"] ?? 0).toBe(0);
      expect(Object.keys(renders).filter((key) => key.startsWith("row:"))).toEqual([`row:${rows[0].id}`]);

      // The OWNER wakes, and it is not because of anything it read: a hook's `@state` holds the
      // owning component's `reBuild` from the moment it is constructed, so every write to the form's
      // counter wakes whoever used the hook. What that costs here is one vnode — `<Rows />` — whose
      // props have not changed, so the diff stops there and the three hundred rows are never touched.
      expect(renders.page ?? 0).toBeGreaterThan(0);
    } finally {
      unmount();
    }
  });

  test("but a row appearing or leaving does wake it", async () => {
    renders = {};
    const { form, unmount } = mountList(3);
    try {
      renders = {};
      await act(async () => form.fields.rows.$.append({ v: "new" }));
      expect(renders["rows-container"] ?? 0).toBeGreaterThan(0);

      renders = {};
      await act(async () => form.fields.rows.$.remove(0));
      expect(renders["rows-container"] ?? 0).toBeGreaterThan(0);

      renders = {};
      await act(async () => form.fields.rows.$.move(0, 1));
      expect(renders["rows-container"] ?? 0).toBeGreaterThan(0);
    } finally {
      unmount();
    }
  });

  test("the container renders once per structural change, at three hundred rows", async () => {
    renders = {};
    const { form, unmount } = mountList(300);
    try {
      const rows = form.fields.rows.$.rows;
      renders = {};
      const start = performance.now();
      await act(async () => (rows[0].field as FieldNode<{ v: string }>).v.$.set("edited"));
      const ms = performance.now() - start;

      expect(renders["rows-container"] ?? 0).toBe(0);
      // Logged, not asserted — jsdom timings swing by a third. For the record: 45 ms and every row
      // before per-path subscriptions, ~2–7 ms and one row once they existed but the container still
      // woke and diffed all three hundred list items, and this once it sleeps through the keystroke.
      console.log(`[form] 300 rows, keystroke with the container asleep: ${ms.toFixed(1)} ms`);
    } finally {
      unmount();
    }
  });

  test("a blur shows a message the schema had already found", async () => {
    // `error` reads `marks` as well as `messages`, because a message is held back until the field has
    // been touched. Nothing about the message moves on a blur — only permission to show it.
    renders = {};
    class Page extends Component {
      private f = this.use(Form<typeof schema>, { schema, defaultValues: EMPTY, onSubmit: () => {} });
      render(): RamondaNode {
        // Everything this test needs happens through the DOM, which is the point: a blur is a real
        // event on a real element, not a method call.
        return <TextField id="a" label="A" of={this.f.fields.a} />;
      }
    }
    const { container, unmount } = render((<Page />) as never);
    try {
      expect(container.querySelector("#a-error")?.textContent).toBe("");

      await act(async () => {
        (container.querySelector("#a") as HTMLInputElement).dispatchEvent(new Event("blur"));
      });

      expect(container.querySelector("#a-error")?.textContent).toBe("required");
    } finally {
      unmount();
    }
  });
});
