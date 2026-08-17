import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "row-keys", "tsconfig.json"));

describe("a row built from data with no key", () => {
  test("is reported from both ways of building rows, and a keyed one is not", () => {
    const found = run().findings["row-without-a-key"];
    expect(found.map((issue) => `${issue.tag}/${issue.via}`)).toEqual([
      "li/map",
      "li/list",
      "tr/map",
      "li/map",
      "li/map",
      "Panel/list",
    ]);
  });

  /**
   * The precision the rule turns on: in `rows.map((row) => <tr><td /></tr>)` the `<tr>` is the row
   * and the `<td>` is not. Asking the `<td>` for a key would be asking for one on every element
   * inside every row, which is advice nobody can follow.
   */
  test("only the element the callback returns is a row", () => {
    const found = run().findings["row-without-a-key"];
    expect(found.some((issue) => issue.tag === "td")).toBe(false);
  });

  /** `(row) => wide ? <li /> : <li />` is two rows, not none. */
  test("both branches of a conditional are rows", () => {
    const found = run().findings["row-without-a-key"];
    expect(found.filter((issue) => issue.tag === "li" && issue.via === "map")).toHaveLength(3);
  });

  /**
   * A COMPONENT row is asked for a key too, unlike every other rule in this family, which ignores
   * components because it is asking about markup. Here the component is what holds the state that
   * goes to the wrong row.
   */
  test("a component row is asked for one as well", () => {
    const found = run().findings["row-without-a-key"];
    expect(found.some((issue) => issue.tag === "Panel")).toBe(true);
  });

  test("an element that is not built from data is left alone", () => {
    const found = run().findings["row-without-a-key"];
    // The fixture writes a lone `<li>`; six reports means it was not one of them.
    expect(found).toHaveLength(6);
  });
});

describe("`class` where `className` was meant", () => {
  test("is reported on a host element and not on a component", () => {
    const found = run().findings["class-instead-of-classname"];
    expect(found.map((issue) => issue.tag)).toEqual(["span"]);
  });
});

describe("two siblings claiming the same key", () => {
  test("the second is reported, and a literal number compares like a string", () => {
    const found = run().findings["duplicate-key-among-siblings"];
    expect(found.map((issue) => `${issue.tag} ${issue.key}`)).toEqual(['li "a"', "li 1"]);
  });

  /**
   * The two silences that make "among siblings" exact rather than approximate: a key under a
   * DIFFERENT parent is a different key, and a key this cannot read is never compared at all —
   * `key={row.id}` may well collide, and deciding that needs the data.
   */
  test("a nested namesake and a key it cannot read are left alone", () => {
    expect(run().findings["duplicate-key-among-siblings"]).toHaveLength(2);
  });
});

test("none of them fails the run", () => {
  const result = run();
  for (const id of ["row-without-a-key", "class-instead-of-classname", "duplicate-key-among-siblings"] as const) {
    expect(result.findings[id].length, id).toBeGreaterThan(0);
  }
  expect(result.issues).toEqual([]);
});
