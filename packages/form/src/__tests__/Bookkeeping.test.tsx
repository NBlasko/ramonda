import { Component, type RamondaNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { Form } from "../Form";
import { childKey, type Path, pathKey } from "../path";
import type { StandardResult, StandardSchemaV1 } from "../types";

/**
 * What the form drops when a value it had recorded something about goes away.
 *
 * `forgetUnder` is the one piece of bookkeeping every array operation runs through, and its answer is a
 * string-prefix question asked of three collections at once. The branch nothing covered is the ROOT: a
 * form whose whole value is an array, where the path is empty, `keyPrefix` is the empty string every
 * key starts with, and the only question left is whether the root's own entry survives.
 */

/**
 * The segment separator inside a stored key.
 *
 * NUL, written as an ESCAPE for the reason `path.ts` gives beside the same constant: a literal control
 * character is invisible to a reader and to a diff. It is the one character a property name cannot
 * carry, which is what stops two different paths sharing a key.
 */
const SEP = "\u0000";

/** Reports on every empty string it finds, wherever it sits, so messages can be watched being dropped. */
function complaining<V>(): StandardSchemaV1<V, V> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => {
        const issues: { message: string; path: (string | number)[] }[] = [];
        const walk = (node: unknown, path: (string | number)[]): void => {
          if (node === "") issues.push({ message: "required", path: [...path] });
          else if (Array.isArray(node)) node.forEach((item, index) => walk(item, [...path, index]));
          else if (node !== null && typeof node === "object") {
            for (const [key, child] of Object.entries(node)) walk(child, [...path, key]);
          }
        };
        walk(value, []);
        return (issues.length === 0 ? { value } : { issues }) as StandardResult<V>;
      },
    },
  };
}

function mount<V>(defaults: V) {
  const schema = complaining<V>();
  let form!: Form<typeof schema>;
  class Page extends Component {
    private f = this.use(Form<typeof schema>, () => ({ schema, defaultValues: defaults, onSubmit: () => {} }));
    render(): RamondaNode {
      form = this.f;
      return <span>x</span>;
    }
  }
  const mounted = render((<Page />) as never);
  return { form, ...mounted };
}

/** The three collections `forgetUnder` prunes, as plain sorted data. */
function recorded(form: object) {
  const inner = form as {
    issues: Map<string, readonly string[]>;
    touchedKeys: Set<string>;
    changedKeys: Set<string>;
  };
  return {
    issues: [...inner.issues.keys()].sort(),
    touched: [...inner.touchedKeys].sort(),
    changed: [...inner.changedKeys].sort(),
  };
}

describe("the two spellings of a key agree", () => {
  test("building a key from its parent's gives what pathKey would", () => {
    // `markKeys` walks the whole form by carrying the parent's key down instead of building a path
    // array per node, so the two have to produce the same string for every shape — including the ones
    // that make it awkward: an index, a key containing the characters `pathToString` uses, and the
    // empty-string property name that shares the root's key.
    const paths: Path[] = [
      [],
      ["a"],
      ["a", "b"],
      ["rows", 0],
      ["rows", 0, "v"],
      ["rows", 12, "deep", 3, "leaf"],
      ["a.b"],
      ["a.b", "c[0]"],
      [""],
      ["", "a"],
      ["with space", "and-dash"],
    ];

    for (const path of paths) {
      let built = "";
      path.forEach((segment, depth) => {
        built = childKey(built, depth, segment);
      });
      expect(built).toBe(pathKey(path));
    }
  });
});

describe("what a removed value takes with it", () => {
  test("a row removed from a nested array", async () => {
    const { form, unmount } = mount({ rows: [{ v: "" }, { v: "keep" }] });
    try {
      await act(async () => form.submit());
      expect(recorded(form).issues).toContain(`rows${SEP}#0${SEP}v`);

      await act(async () => form.fields.rows.$.remove(0));

      // Everything under the array was re-addressed by the validation that followed, so what is left
      // describes the rows that are there now — and row 1 is gone, because there is no row 1.
      const after = recorded(form);
      expect(after.issues.some((key) => key.startsWith(`rows${SEP}#1`))).toBe(false);
      expect(form.values.rows).toEqual([{ v: "keep" }]);
    } finally {
      unmount();
    }
  });

  test("a form whose whole value is an array", async () => {
    const { form, unmount } = mount<string[]>(["", "b", "c"]);
    try {
      await act(async () => form.submit());
      const before = recorded(form);
      expect(before.issues).toContain("#0");
      // The root is touched too, and an operation ON the root must not drop its mark.
      expect(before.touched).toContain("");

      await act(async () => form.fields.$.remove(1));

      const after = recorded(form);
      expect(form.values).toEqual(["", "c"]);
      expect(after.touched).toContain("");
      // Everything else went with the rows it described.
      expect(after.touched.filter((key) => key !== "")).toEqual([]);
      expect(after.changed).toEqual([]);
    } finally {
      unmount();
    }
  });

  test("a field reset forgets that field and leaves its neighbour alone", async () => {
    const { form, unmount } = mount({ a: "", b: "" });
    try {
      await act(async () => form.submit());
      expect(recorded(form).issues).toEqual(["a", "b"]);

      await act(async () => form.fields.a.$.reset());

      // `resetAt` does not keep self, so `a`'s own mark goes; `b` is not under `a` and stays.
      const after = recorded(form);
      expect(after.touched).toContain("b");
      expect(after.touched).not.toContain("a");
    } finally {
      unmount();
    }
  });

  test("the cost, over a form a submit has touched everywhere", () => {
    const wide: Record<string, unknown> = { rows: [{ v: "x" }, { v: "y" }, { v: "z" }] };
    for (let index = 0; index < 300; index++) wide[`f${index}`] = { a: "x", b: "y", c: "z" };

    const { form, unmount } = mount(wide);
    try {
      const inner = form as unknown as {
        touchAll(): void;
        forgetUnder(path: readonly (string | number)[], options?: { keepSelf: boolean }): void;
        touchedKeys: Set<string>;
      };
      inner.touchAll();
      const marks = inner.touchedKeys.size;
      // The measurement is only interesting because the collection is big — assert that much, so a
      // future change that stops `touchAll` filling it does not leave a benchmark measuring nothing.
      expect(marks).toBeGreaterThan(1000);

      const touchRuns = 200;
      const touchStart = performance.now();
      for (let run = 0; run < touchRuns; run++) {
        (form as unknown as { touchedKeys: Set<string> }).touchedKeys = new Set();
        inner.touchAll();
      }
      console.log(
        `[form] touchAll over ${marks} paths: ${(((performance.now() - touchStart) / touchRuns) * 1000).toFixed(1)} µs`,
      );

      inner.forgetUnder(["rows"], { keepSelf: true });
      const runs = 500;
      const start = performance.now();
      for (let run = 0; run < runs; run++) inner.forgetUnder(["rows"], { keepSelf: true });
      const each = ((performance.now() - start) / runs) * 1000;

      // Logged rather than asserted: jsdom timings swing by a third run to run, so a threshold here
      // would be a flaky test pretending to be a measurement. For the record — 424 µs while the
      // coverage test took a `Path` and so rebuilt `pathKey` for every key it was asked about, 55 µs
      // once it is built once per call.
      console.log(`[form] forgetUnder over ${marks} marks: ${each.toFixed(1)} µs`);
    } finally {
      unmount();
    }
  });
});

/**
 * The shared empty list, and why several forms — or several buttons — cannot reach each other through it.
 *
 * `NO_MESSAGES` is one module-level array handed to every field that has nothing to say. Sharing it is
 * what keeps a render stable: a fresh `[]` per read is a new identity every time, which RMD020 reports
 * and which would cost a field its element. What makes it safe is that nothing ever writes into it —
 * asserted here, from the outside, the way an app would reach it.
 */
describe("the shared empty message list", () => {
  test("two forms hand back the same one, and neither can spoil it for the other", async () => {
    const left = mount({ a: "" });
    const right = mount({ a: "" });
    try {
      const one = left.form.fields.a.$.errors;
      const two = right.form.fields.a.$.errors;

      expect(one).toEqual([]);
      expect(one).toBe(two);

      // A caller who pushes into what they were given hears about it, rather than adding a message to
      // every field in every form on the page.
      expect(() => (one as string[]).push("mine")).toThrow(TypeError);
      expect(right.form.fields.a.$.errors).toEqual([]);
    } finally {
      left.unmount();
      right.unmount();
    }
  });

  test("a real message is a list of its own", async () => {
    const { form, unmount } = mount({ a: "" });
    try {
      await act(async () => form.submit());

      const errors = form.fields.a.$.errors;
      expect(errors).toEqual(["required"]);
      // Not the shared one, so nothing above applies to it.
      expect(Object.isFrozen(errors)).toBe(false);
    } finally {
      unmount();
    }
  });
});

/**
 * What the field tree keeps, and what it lets go of.
 *
 * A node is created once and handed back for the life of the form, deliberately: a fresh one per access
 * is a fresh `bind.onInput` per access, which RMD020 reports and which really does re-attach the
 * listener. But "for the life of the form" was also true of a row that had been REMOVED — so a form that
 * once showed ten thousand rows went on holding a node and a handle for every one of them, each handle
 * carrying two bound closures and a row cache.
 */
describe("the tree lets go of rows that are gone", () => {
  function sizes(form: object) {
    const inner = form as {
      tree: { nodes: Map<string, unknown>; handles: Map<string, unknown> };
      quietTree: { nodes: Map<string, unknown>; handles: Map<string, unknown> };
    };
    return {
      nodes: inner.tree.nodes.size,
      handles: inner.tree.handles.size,
      quietNodes: inner.quietTree.nodes.size,
    };
  }

  test("a form grown and shrunk keeps only what it still has", async () => {
    const { form, unmount } = mount({ rows: [] as { v: string }[] });
    try {
      for (let index = 0; index < 200; index++) form.fields.rows.$.append({ v: `v${index}` });
      // Reach every field, the way a render of two hundred rows does.
      for (const row of form.fields.rows.$.rows) void (row.field as { v: { $: { value: unknown } } }).v.$.value;

      const grown = sizes(form);
      expect(grown.nodes).toBeGreaterThan(400);

      while (form.fields.rows.$.length > 3) form.fields.rows.$.remove(form.fields.rows.$.length - 1);

      const shrunk = sizes(form);
      // Three rows, each with a node for the row and one for its field, plus the root and the array.
      expect(shrunk.nodes).toBeLessThan(12);
      expect(shrunk.handles).toBeLessThan(12);
      console.log(`[form] tree after 200 rows shrank to 3: ${grown.nodes} nodes -> ${shrunk.nodes}`);
    } finally {
      unmount();
    }
  });

  test("the rows that survive keep the identity they had", () => {
    const { form, unmount } = mount({ rows: [{ v: "a" }, { v: "b" }, { v: "c" }] });
    try {
      const first = form.fields.rows.$.rows[0].field;
      const second = form.fields.rows.$.rows[1].field;

      // Removing the LAST row must not disturb the two before it — losing their identity would cost
      // them their elements and whatever the browser was holding in them.
      form.fields.rows.$.remove(2);

      expect(form.fields.rows.$.rows[0].field).toBe(first);
      expect(form.fields.rows.$.rows[1].field).toBe(second);
      expect(form.fields.rows.$.length).toBe(2);
    } finally {
      unmount();
    }
  });

  test("a row appearing where a removed one sat is a different row", () => {
    const { form, unmount } = mount({ rows: [{ v: "a" }, { v: "b" }] });
    try {
      const gone = form.fields.rows.$.rows[1].field;
      form.fields.rows.$.remove(1);
      form.fields.rows.$.append({ v: "new" });

      // Not the same node, and it should not be: the row at index 1 is a different row now, and handing
      // back the old node would hand back its remembered control kind and its bound handlers too.
      expect(form.fields.rows.$.rows[1].field).not.toBe(gone);
      expect(form.fields.rows.$.rows[1].field.v.$.value).toBe("new");
    } finally {
      unmount();
    }
  });
});
