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
    private f = this.use(Form<typeof schema>, { schema, defaultValues: defaults, onSubmit: () => {} });
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
