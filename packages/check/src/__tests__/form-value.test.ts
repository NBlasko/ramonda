import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "form-value");
const found = () => analyzeProject(join(fixture, "tsconfig.json")).findings["form-value-in-the-wrong-control"] ?? [];
const lineOf = (label: string) =>
  readFileSync(join(fixture, "app.tsx"), "utf8")
    .split("\n")
    .findIndex((line) => line.includes(`aria-label="${label}"`)) + 1;

/**
 * A number or a day a form's field shows, in a control that does not hand it back. Read off the type
 * of the control's `value`, which the form marks — so the program is read with types when the project
 * imports `@ramonda/form`, and only then.
 */
describe("a form value in the wrong control", () => {
  test("each shape is reported, and named", () => {
    expect(found().map((issue) => [issue.line, issue.kind, issue.control])).toEqual([
      [lineOf("age as text"), "number", "<input>"],
      [lineOf("age typed text"), "number", '<input type="text">'],
      [lineOf("born as a number"), "day", '<input type="number">'],
      [lineOf("age in a text area"), "number", "<TextArea>"],
      [lineOf("age in a select") - 0, "number", "<Select>"],
      [lineOf("age in an unread type"), "type-unread", "<input type={kind}>"],
      [lineOf("loose"), "unreadable", "<input>"],
    ]);
  });
});
