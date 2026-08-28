import { describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFixes } from "../fix";
import type { Findings } from "../analyze";

const file = () => join(mkdtempSync(join(tmpdir(), "ramonda-fix-")), "app.tsx");

/** A findings shape with only the half the fixer reads, which is all it reads. */
const reporting = (path: string, edits: { from: number; to: number; text: string; says: string }[]): Findings =>
  ({
    "a-rule": edits.map((edit) => ({ file: path, line: 1, column: 1, edit })),
  }) as unknown as Findings;

/**
 * Applying the answers a run already knows.
 *
 * Everything here is about not being wrong. A wrong report costs a reader a minute; a wrong EDIT
 * costs them a revert, and their trust in every edit that was right along with it.
 */
describe("the fixes a run can apply itself", () => {
  test("edits are applied back to front, so one cannot move the next one's offsets", () => {
    const path = file();
    writeFileSync(path, "aaa bbb ccc", "utf8");

    // Given in the order a walk would find them — first to last, and of different lengths.
    const result = applyFixes(
      reporting(path, [
        { from: 0, to: 3, text: "AAAAAA", says: "first" },
        { from: 8, to: 11, text: "C", says: "third" },
      ]),
      true,
    );

    expect(result.applied).toBe(2);
    expect(readFileSync(path, "utf8")).toBe("AAAAAA bbb C");
  });

  /**
   * Two edits wanting the same characters DISAGREE about what those characters should say.
   *
   * Picking the first, or the longer, or the one whose rule happens to be registered earlier, is a
   * coin toss wearing a rule's name. Neither is applied, and the run says how many it left.
   */
  test("overlapping edits are dropped rather than merged, and counted", () => {
    const path = file();
    writeFileSync(path, "aaa bbb ccc", "utf8");

    const result = applyFixes(
      reporting(path, [
        { from: 0, to: 7, text: "X", says: "one" },
        { from: 4, to: 11, text: "Y", says: "two" },
      ]),
      true,
    );

    expect(result.applied).toBe(1);
    expect(result.overlapping).toBe(1);
    // The one that survived did so alone: the file is not both edits, and not neither.
    expect(readFileSync(path, "utf8")).toBe("aaa Y");
  });

  /** `--dry-run` is the same work and the same answers, with nothing written. */
  test("a dry run says what it would do and touches nothing", () => {
    const path = file();
    writeFileSync(path, "aaa bbb", "utf8");

    const result = applyFixes(reporting(path, [{ from: 0, to: 3, text: "zzz", says: "rename" }]), false);

    expect(result.applied).toBe(1);
    expect(result.said).toEqual([`${path} — rename`]);
    expect(readFileSync(path, "utf8")).toBe("aaa bbb");
  });

  /**
   * A BOM, which is the one place the two readers of a file disagree.
   *
   * TypeScript STRIPS a byte-order mark, so every offset a rule produces is relative to the text
   * without it; `readFileSync` keeps it. Slicing the kept text with the stripped text's offsets put
   * every edit one character early — measured on a real file, `<div class="card">` came back
   * `<divclassNames="card">`, having eaten the space and left the `s` behind.
   *
   * The offsets here are deliberately written as if a BOM were absent, because that is what a rule
   * produces. A regression would corrupt the file rather than fail loudly, which is why this test
   * asserts the whole resulting string and not just that something changed.
   */
  test("a byte-order mark shifts nothing, and survives the write", () => {
    const path = file();
    writeFileSync(path, "\uFEFFaaa bbb", "utf8");

    // `from`/`to` count from the `a`, exactly as TypeScript would report them.
    applyFixes(reporting(path, [{ from: 4, to: 7, text: "BBB", says: "rename" }]), true);

    expect(readFileSync(path, "utf8")).toBe("\uFEFFaaa BBB");
  });

  /** A run whose faults all need a person is a run with nothing to apply, not an error. */
  test("findings with no edits are nothing to do", () => {
    const result = applyFixes(
      { "a-rule": [{ file: "/nowhere.tsx", line: 1, column: 1 }] } as unknown as Findings,
      true,
    );

    expect(result.applied).toBe(0);
    expect(result.files).toEqual([]);
  });
});
