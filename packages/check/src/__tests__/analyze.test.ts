import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = (name: string) => analyzeProject(join(here, "fixtures", name, "tsconfig.json"));

/**
 * The property that matters most is the SILENCE: a build gate that cries wolf is one people
 * disable. So the passing cases are as much the point as the failing ones.
 */

describe("reports a path with no provider", () => {
  test("nobody provides the context at all", () => {
    const { issues } = run("missing");
    expect(issues).toHaveLength(1);
    expect(issues[0].consumer).toBe("Reader");
    expect(issues[0].context).toBe("Theme");
    expect(issues[0].path).toEqual(["App", "Reader"]);
  });

  test("THE REORDER: the provider exists, but not above this consumer", () => {
    const { issues } = run("reorder");
    expect(issues).toHaveLength(1);
    expect(issues[0].consumer).toBe("Reader");
    // Sidebar provides it — on its own branch. Reader's branch has nothing.
    expect(issues[0].path).toEqual(["App", "Reader"]);
  });
});

describe("stays quiet when the provider really is above", () => {
  test("provider on the root, consumer two levels down", () => {
    expect(run("ok").issues).toEqual([]);
  });

  test("consumer passed as children of the providing wrapper", () => {
    // The ownership rule: children of <Shell> mount UNDER Shell, so Shell's provider covers them.
    // Getting this wrong is the likeliest false positive there is.
    expect(run("children").issues).toEqual([]);
  });
});

describe("it can see the app at all", () => {
  test("counts what it found", () => {
    const { counts } = run("ok");
    expect(counts.contexts).toBe(1);
    expect(counts.roots).toBe(1);
    expect(counts.components).toBeGreaterThanOrEqual(3);
  });
});

/**
 * Function literals in class fields.
 *
 * The whole value of doing this in the SOURCE is the line between a function written in the field
 * and a function a call returned. At runtime they are the same thing — `bindInstanceMethods` has
 * put a bound function on the instance under every method's name by the time anything could look,
 * and `debounce(this.save, 200)` is a function there too. Only one of them is a mistake.
 */
describe("function literals held in class fields", () => {
  const found = () => run("arrows").arrowFields;

  test("reports an arrow, a function expression, and nothing else", () => {
    expect(found().map((f) => `${f.component}.${f.field}`)).toEqual([
      "Panel.onPick",
      "Panel.format",
      "Panel.legacy",
      "Counter.tick",
    ]);
  });

  test("a field initialised from a CALL is left alone", () => {
    // `debounce(this.persist, 200)` and `memoize(this.compute)` are functions, and both are
    // legitimate: a wrapper cannot be written as a method. This is the case a runtime check
    // cannot tell apart, and the reason this one reads the source.
    const names = found().map((f) => f.field);
    expect(names).not.toContain("save");
    expect(names).not.toContain("cheap");
  });

  test("a value that is not a function is not a finding", () => {
    const names = found().map((f) => f.field);
    expect(names).not.toContain("label");
    expect(names).not.toContain("rows");
  });

  test("a static field is one per class, so it is not a finding", () => {
    expect(found().map((f) => f.component)).not.toContain("Statics");
  });

  test("a class that is not a component or a hook is not this check's business", () => {
    expect(found().map((f) => f.component)).not.toContain("Plain");
  });

  test("says whether it reads `this`, because that decides the fix", () => {
    const by = Object.fromEntries(found().map((f) => [f.field, f]));
    // Reads the instance → it wants to be a method, which Ramonda binds for you.
    expect(by["onPick"].readsThis).toBe(true);
    expect(by["tick"].readsThis).toBe(true);
    // Reads nothing of the instance → it wants to leave the class entirely.
    expect(by["format"].readsThis).toBe(false);
  });

  test("names the file and the line, so the report is a place to go", () => {
    const first = found()[0];
    expect(first.file).toMatch(/fixtures\/arrows\/app\.tsx$/);
    expect(first.line).toBeGreaterThan(0);
    expect(first.column).toBeGreaterThan(0);
  });

  test("the other fixtures have none, so the check is silent on ordinary code", () => {
    for (const name of ["ok", "missing", "reorder", "children"]) {
      expect(run(name).arrowFields, name).toEqual([]);
    }
  });
});

/**
 * Single-use decorators declared twice on one class.
 *
 * The framework reports what it can once a component mounts (RMD032 for `@catchError`), which is
 * exactly the gap this package exists for: a class behind a condition nobody clicked ships with the
 * fault and nothing has said a word. The line that matters is the same one as everywhere else here
 * — a SUBCLASS declaring its own is an override, not a duplicate, and reporting it would be advice
 * to delete the line doing the work.
 */
describe("single-use decorators declared twice", () => {
  const found = () => run("duplicate-decorators").duplicateDecorators;

  test("reports a method decorator and a class decorator, once each", () => {
    expect(found().map((d) => `${d.component}.@${d.decorator}x${d.count}`)).toEqual([
      "Twice.@catchError x2".replace(" ", ""),
      "GatedTwice.@ShouldUpdateOnPropsChange x2".replace(" ", ""),
    ]);
  });

  test("a subclass declaring its own is silent, and so is one of each", () => {
    const names = found().map((d) => d.component);
    expect(names).not.toContain("Sub");
    expect(names).not.toContain("Base");
    expect(names).not.toContain("Fine");
  });

  test("it points at the declaration", () => {
    const first = found()[0];
    expect(first.file).toMatch(/duplicate-decorators\/app\.tsx$/);
    expect(first.line).toBeGreaterThan(0);
    expect(first.column).toBeGreaterThan(0);
  });
});
