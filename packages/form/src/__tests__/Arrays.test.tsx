import { Component, type RamondaNode } from "@ramonda/core";
import { render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { Form } from "../Form";
import type { StandardResult, StandardSchemaV1 } from "../types";

/**
 * Array fields, and the thing they exist to get right: a row's identity is not its index.
 *
 * Remove row 0 and every index below it shifts. If a row's error, its focus and its DOM
 * node are filed under the index, they all slide onto the wrong row — which is the failure
 * every form library has to answer, and the reason `rows` hands out a generated `id`.
 */
interface Values {
  tags: string[];
  contacts: { kind: string; value: string }[];
}

const SEED: Values = { tags: ["a", "b", "a"], contacts: [] };

/** Reports on any tag that is empty, so a message can be watched as rows move under it. */
const schema: StandardSchemaV1<Values, Values> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const values = value as Values;
      const issues = values.tags.flatMap((tag, index) =>
        tag === "" ? [{ path: ["tags", index], message: "a tag cannot be empty" }] : [],
      );
      const result: StandardResult<Values> = issues.length === 0 ? { value: values } : { issues };
      return result;
    },
  },
};

function mount(defaults: Values = SEED) {
  let form!: Form<typeof schema>;

  class Page extends Component {
    private f = this.use(Form<typeof schema>, {
      schema,
      defaultValues: defaults,
      onSubmit: (_values) => {},
    });

    render(): RamondaNode {
      form = this.f;
      return <form />;
    }
  }

  const mounted = render((<Page />) as never);
  return { form, ...mounted };
}

describe("array fields", () => {
  test("rows carry an identity, and an array of equal primitives still gets distinct ones", () => {
    // `["a", "b", "a"]` — the case a WeakMap cannot key and a value cannot supply, which is
    // why the ids are minted and held alongside rather than derived.
    const { form, unmount } = mount();
    try {
      const ids = form.fields.tags.$.rows.map((row) => row.id);

      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
      expect(form.fields.tags.$.rows.map((row) => row.index)).toEqual([0, 1, 2]);
    } finally {
      unmount();
    }
  });

  test("removing the first row leaves the others with the identities they had", () => {
    const { form, unmount } = mount();
    try {
      const before = form.fields.tags.$.rows.map((row) => row.id);

      form.fields.tags.$.remove(0);
      const after = form.fields.tags.$.rows.map((row) => row.id);

      // The rows that survived kept their ids; only the indexes moved.
      expect(after).toEqual([before[1], before[2]]);
      expect(form.fields.tags.$.rows.map((row) => row.index)).toEqual([0, 1]);
      expect(form.values.tags).toEqual(["b", "a"]);
    } finally {
      unmount();
    }
  });

  test("insert and append mint a new identity and leave the rest alone", () => {
    const { form, unmount } = mount();
    try {
      const before = form.fields.tags.$.rows.map((row) => row.id);

      form.fields.tags.$.insert(1, "x");
      form.fields.tags.$.append("z");

      const after = form.fields.tags.$.rows.map((row) => row.id);
      expect(form.values.tags).toEqual(["a", "x", "b", "a", "z"]);
      expect([after[0], after[2], after[3]]).toEqual(before);
      expect(new Set(after).size).toBe(5);
    } finally {
      unmount();
    }
  });

  test("`rows` keeps ONE identity until the list actually changes", () => {
    // `list()`'s `each` is what RMD020 compares, and a rebuilt array costs every row its
    // identity in the reconciler — the exact failure the ids exist to prevent.
    const { form, unmount } = mount();
    try {
      const first = form.fields.tags.$.rows;
      expect(form.fields.tags.$.rows).toBe(first);

      // A change somewhere else does not disturb it.
      form.fields.contacts.$.append({ kind: "email", value: "a@b.c" });
      expect(form.fields.tags.$.rows).toBe(first);

      form.fields.tags.$.append("new");
      expect(form.fields.tags.$.rows).not.toBe(first);
    } finally {
      unmount();
    }
  });

  test("a row's field node is the same object the tree hands out by index", () => {
    const { form, unmount } = mount();
    try {
      expect(form.fields.tags.$.rows[0].field).toBe(form.fields.tags[0]);
      expect(form.fields.tags.$.rows[1].field.$.value).toBe("b");
    } finally {
      unmount();
    }
  });

  test("a message follows the row it is about, not the index it used to sit at", () => {
    const { form, unmount } = mount({ tags: ["ok", "", "fine"], contacts: [] });
    try {
      form.submit();
      expect(form.fields.tags[1].$.error).toBe("a tag cannot be empty");

      // Drop the row above the empty one. The message must now be on index 0.
      form.fields.tags.$.remove(0);

      expect(form.values.tags).toEqual(["", "fine"]);
      expect(form.fields.tags[0].$.error).toBe("a tag cannot be empty");
      expect(form.fields.tags[1].$.error).toBeUndefined();
    } finally {
      unmount();
    }
  });

  test("nested rows work the same, one level down", () => {
    const { form, unmount } = mount({ tags: [], contacts: [{ kind: "email", value: "a@b.c" }] });
    try {
      const row = form.fields.contacts.$.rows[0];

      expect(row.field.kind.$.value).toBe("email");
      expect(row.field.value.$.path).toBe("contacts[0].value");

      row.field.value.$.set("z@z.z");
      expect(form.values.contacts[0].value).toBe("z@z.z");
    } finally {
      unmount();
    }
  });

  test("an array replaced wholesale keeps the identities of the rows that were already there", () => {
    // `set` on the array itself bypasses `splice`, so the ids are topped up rather than
    // renumbered — a row that survived a bulk write should not look like a new row.
    const { form, unmount } = mount();
    try {
      const before = form.fields.tags.$.rows.map((row) => row.id);

      form.fields.tags.$.set(["a", "b", "a", "d"]);
      const after = form.fields.tags.$.rows.map((row) => row.id);

      expect(after.slice(0, 3)).toEqual(before);
      expect(after).toHaveLength(4);
    } finally {
      unmount();
    }
  });

  test("each array numbers its own rows, so nothing depends on read order", () => {
    // One counter for the whole form made an id depend on which array was read first: `tags`
    // got r0 then r2, because reading `contacts` in between took r1. Harmless until a server
    // render and its hydration read in different orders, at which point the `list()` keys
    // disagree and every row is thrown away and rebuilt.
    const { form, unmount } = mount({ tags: ["a"], contacts: [{ kind: "email", value: "x" }] });
    try {
      // Read the OTHER array in between, which is what used to consume a number.
      expect(form.fields.contacts.$.rows.map((row) => row.id)).toEqual(["r0"]);
      form.fields.tags.$.append("b");

      expect(form.fields.tags.$.rows.map((row) => row.id)).toEqual(["r0", "r1"]);
    } finally {
      unmount();
    }
  });

  test("`length` reports the list, and an absent list is empty rather than an error", () => {
    const { form, unmount } = mount({ tags: [], contacts: [] });
    try {
      expect(form.fields.tags.$.length).toBe(0);
      expect(form.fields.tags.$.rows).toEqual([]);
    } finally {
      unmount();
    }
  });

  test("appending into an empty form builds the shape rather than throwing", () => {
    const { form, unmount } = mount({ tags: [], contacts: [] });
    try {
      form.fields.contacts.$.append({ kind: "phone", value: "060" });

      expect(form.values.contacts).toEqual([{ kind: "phone", value: "060" }]);
      expect(form.fields.contacts[0].kind.$.value).toBe("phone");
    } finally {
      unmount();
    }
  });
});
