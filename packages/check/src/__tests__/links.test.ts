import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "links", "tsconfig.json"));
const found = () => run().findings["link-without-a-destination"];

/**
 * An `<a>` that goes nowhere, walked through `.claude/skills/writing-a-static-rule`.
 *
 * The rule holds on every spelling it claims and on the three that must stay silent. What the walk
 * added is the pair the reader is likeliest to write next — the destination one name away — and the
 * measurement behind the one silence that looks like an oversight.
 */
describe("a link with no destination", () => {
  test("every spelling of nowhere is reported, and named", () => {
    expect(found().map((issue) => `${issue.line} ${issue.kind}`)).toEqual([
      "12 no href",
      "13 empty href",
      "14 empty fragment",
      "15 javascript:",
      // The same two, one name away — `attr` follows a name to its declaration.
      "18 empty fragment",
      "19 empty href",
      // Shouting, and whitespace. Both are the same claim as their tidy spellings.
      "22 javascript:",
      "23 empty href",
      "28 no href",
    ]);
  });

  /**
   * `handled` decides what the advice says — a link with a click handler is a button wearing a
   * link's clothes, and the fix is a `<button>` rather than an `href`.
   *
   * The attribute is `onclick`, which is what core renamed it to. `has` is case-insensitive and
   * matched the old spelling, so this is also the proof the rename did not silence the rule.
   */
  test("a click handler instead of a destination changes what the advice says", () => {
    expect(
      found()
        .filter((issue) => issue.handled)
        .map((issue) => issue.line),
    ).toEqual([28]);
  });

  /** A real fragment, the legacy anchor TARGET, and a real path. */
  test("a destination that exists is not reported", () => {
    const lines = found().map((issue) => issue.line);

    for (const line of [26, 30, 32]) expect(lines).not.toContain(line);
    expect(found()).toHaveLength(9);
  });
});
