import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const at = join(here, "fixtures", "lazy-collide");
const found = () => analyzeProject(join(at, "tsconfig.json")).findings["lazy-imports-that-collide"];
const where = (issue: { file: string; line: number }) =>
  `${issue.file.slice(issue.file.indexOf("lazy-collide/") + "lazy-collide/".length)}:${issue.line}`;

/** The 1-based line a labelled site sits on, read off the file so a number cannot go stale. */
const lineOf = (dir: string, label: string) => {
  const source = readFileSync(join(at, dir, "Uses.tsx"), "utf8").split("\n");
  const found = source.findIndex((line) => line.includes(label));
  if (found < 0) throw new Error(`no line in ${dir}/Uses.tsx holds ${label}`);
  return found + 1;
};

/**
 * Two `lazy` functions written the same way, loading different modules.
 *
 * `AsyncLoad` keys its module cache on the SOURCE of the `lazy` — `cacheKeyFor` reads
 * `props.lazy.toString()` — so `() => import("./Panel")` is one string and a different module in
 * every directory it is written in. `RMD049` reports it at runtime once both have rendered; this
 * reads both sites from the source at once.
 */
describe("two lazy functions under one cache key", () => {
  test("the same text naming different modules is reported at every site", () => {
    expect(found().map(where).sort()).toEqual(
      [
        `one/Uses.tsx:${lineOf("one", '<AsyncLoad lazy={() => import("./Panel")}')}`,
        `one/Uses.tsx:${lineOf("one", "AsyncLoad lazy={loadPanel}")}`,
        `two/Uses.tsx:${lineOf("two", '<AsyncLoad lazy={() => import("./Panel")}')}`,
        `two/Uses.tsx:${lineOf("two", "AsyncLoad lazy={loadPanelTwo}")}`,
      ].sort(),
    );
  });

  /**
   * A report about a PAIR has to name both ends, or it names half a fault: the site being reported
   * is not wrong on its own, and a reader cannot judge it without the one it collides with.
   */
  test("each report names the site it collides with", () => {
    for (const issue of found()) {
      expect(issue.otherFile).not.toBe(issue.file);
      expect(issue.otherLine).toBeGreaterThan(0);
    }
  });

  /**
   * Followed one hop through a name, because a module-level `const loadPanel = () => import(…)` is
   * what the documentation now tells people to write. Reading only the attribute would go silent on
   * the recommended spelling — which is the shape most likely to be repeated across files, since a
   * name is what gets copied.
   */
  test("a named thunk is the same fault as one written in the attribute", () => {
    const named = found().filter((issue) => issue.written.startsWith("() => import"));
    expect(named).toHaveLength(4);
  });

  /**
   * Three silences, each taken from the runtime rather than invented.
   *
   * `claim()` fires only when the two load DIFFERENT modules, believes an explicit `cacheKey`, and
   * a bare specifier names one package wherever it is written. The spread is this package's own
   * standing rule: a report settled by an attribute that is NOT written is not provable past one.
   */
  test("a same-directory pair, an explicit cacheKey, a spread and a bare specifier are all silent", () => {
    const lines = found().map(where);

    expect(lines.some((line) => line.startsWith("same/"))).toBe(false);
    for (const [dir, label] of [
      ["one", "cacheKey"],
      ["one", "{...rest}"],
      ["one", 'import("@ramonda/core")'],
    ] as const) {
      expect(lines).not.toContain(`${dir}/Uses.tsx:${lineOf(dir, label)}`);
    }
    // The negatives above cannot go quiet unnoticed while this holds the total.
    expect(lines).toHaveLength(4);
  });
});
