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
      "11 no href",
      "12 empty href",
      "13 empty fragment",
      "14 javascript:",
      // The same two, one name away — `attr` follows a name to its declaration.
      "17 empty fragment",
      "18 empty href",
      // Shouting, and whitespace. Both are the same claim as their tidy spellings.
      "21 javascript:",
      "22 empty href",
      "27 no href",
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
    ).toEqual([27]);
  });

  /** A real fragment, the legacy anchor TARGET, and a real path. */
  test("a destination that exists is not reported", () => {
    const lines = found().map((issue) => issue.line);

    for (const line of [30, 32, 34]) expect(lines).not.toContain(line);
    expect(found()).toHaveLength(9);
  });
});
