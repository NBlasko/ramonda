import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const at = join(here, "fixtures", "object-among-children");
const found = () => analyzeProject(join(at, "tsconfig.json")).findings["object-among-the-children"];

const lineOf = (label: string) => {
  const source = readFileSync(join(at, "app.tsx"), "utf8").split("\n");
  const line = source.findIndex((one) => one.includes(label));
  if (line < 0) throw new Error(`no line in the fixture holds ${label}`);
  return line + 1;
};

/**
 * A plain object among an element's children.
 *
 * `vdom/h.ts` replaces it with a hole — *"an object that is not a vnode has nothing the diff can do
 * with it"* — and `RMD037` says so in a development build. The failure is silent and looks like
 * data: the page renders without the thing and nothing is red.
 */
describe("an object among the children", () => {
  test("a literal, a local, a module constant and one arm of a branch are all reported", () => {
    expect(found().map((issue) => issue.line)).toEqual([
      lineOf("{{ a: 1 }}"),
      lineOf("<p>{local}</p>"),
      lineOf("<p>{CONFIG}</p>"),
      lineOf("? CONFIG : null"),
    ]);
  });

  /**
   * A MODULE CONSTANT counts here and is the fix in `fresh-object-in-props`, which walks the same
   * `follow`. The two ask different questions: "is this REBUILT?", where a module constant is the
   * answer, and "what IS this?", where it is still an object and the runtime still drops it.
   */
  test("a module constant is reported here, unlike in the rebuilt-value question", () => {
    const issue = found().find((one) => one.line === lineOf("<p>{CONFIG}</p>"));
    expect(issue?.builtIn).toBe("`CONFIG`");
  });

  /** The report quotes the line: `{config}` and `{{…}}` are one fault and read nothing alike. */
  test("the report quotes what is written", () => {
    expect(
      found()
        .map((issue) => issue.written)
        .slice(0, 3),
    ).toEqual(["{ a: 1 }", "local", "CONFIG"]);
  });

  /**
   * The silences, each its own reason. An ARRAY is flattened into the children rather than dropped,
   * so a group is markup. A CALL may hand back a vnode, and this rule's claim is that the page is
   * MISSING something — a report there would be that claim without the proof. A prop is not
   * knowable. And reading a field off the object is what the fixed line looks like.
   */
  test("an array, a list, a call, a prop, a field read, a vnode, text and a number are silent", () => {
    const lines = found().map((issue) => issue.line);

    for (const label of [
      "<p>{this.props.item}</p>",
      "<p>{this.props.item.name}</p>",
      "<p>{this.rows}</p>",
      "list(this.rows",
      "<span>ok</span>",
      '{"text"}',
      "{this.rows.length}",
      "{unknownThing}",
      "{build()}",
    ]) {
      expect(lines, label).not.toContain(lineOf(label));
    }
    expect(lines).toHaveLength(4);
  });
});
