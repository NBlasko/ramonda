import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { warnIfStale } from "../stale";

/**
 * The warning that says a built package is behind its sources.
 *
 * **It exists because of a day, not a hypothesis.** Everything a person runs reads `dist` — the Vite
 * plugin, the editor's language plugin, the documentation gate, the build test — and the tests read
 * `src`. So a fix can be green everywhere and absent from everything they touch, with nothing to
 * see: the artefact is a valid previous version, not a broken one.
 *
 * On 2026-09-07 that misled us three times, and the third time a user was handed a `dist` twenty
 * minutes old and reported a fixed bug as still present. They were right, the source was right, and
 * neither fact helped.
 */
describe("the stale-dist warning", () => {
  /** A package with `src` and `dist`, whose mtimes are set rather than waited for. */
  const built = (sourceAt: number, distAt: number) => {
    const root = mkdtempSync(join(tmpdir(), "stale-"));
    for (const [where, at] of [
      ["src", sourceAt],
      ["dist", distAt],
    ] as const) {
      mkdirSync(join(root, where));
      const file = join(root, where, "index.js");
      writeFileSync(file, "//\n");
      utimesSync(file, at / 1000, at / 1000);
      utimesSync(join(root, where), at / 1000, at / 1000);
    }
    // `warnIfStale` is given a file inside `dist`, as `import.meta.url` gives it.
    return join(root, "dist", "index.js");
  };

  const said = (from: string) => {
    const heard: string[] = [];
    warnIfStale(from, (message) => heard.push(message));
    return heard;
  };

  const now = Date.now();

  test("says so when dist is behind src", () => {
    const [only, ...rest] = said(built(now, now - 20 * 60_000));

    expect(rest).toEqual([]);
    expect(only).toContain("previous version");
    expect(only).toContain("pnpm --filter @ramonda/css build");
  });

  test("and names how far behind, so it is obvious whether it matters", () => {
    expect(said(built(now, now - 20 * 60_000))[0]).toContain("20 minute");
  });

  test("silent when dist is newer, which is every ordinary run", () => {
    expect(said(built(now - 60_000, now))).toEqual([]);
  });

  test("silent when they are the same age", () => {
    expect(said(built(now, now))).toEqual([]);
  });

  /**
   * A published package has no `src`, and a fresh checkout has no `dist`. Warning in either would be
   * telling somebody about a directory they will never have, or about a build they are about to run.
   */
  test("silent with no src to compare against", () => {
    const root = mkdtempSync(join(tmpdir(), "stale-"));
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist", "index.js"), "//\n");

    expect(said(join(root, "dist", "index.js"))).toEqual([]);
  });

  test("silent with no dist at all", () => {
    const root = mkdtempSync(join(tmpdir(), "stale-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "index.ts"), "//\n");

    expect(said(join(root, "dist", "index.js"))).toEqual([]);
  });

  /** A test file changing is not a reason to rebuild — `dist` never held them. */
  test("silent when only a test is newer", () => {
    const from = built(now - 60_000, now);
    const root = join(from, "..", "..");
    mkdirSync(join(root, "src", "__tests__"), { recursive: true });
    const test = join(root, "src", "__tests__", "a.test.ts");
    writeFileSync(test, "//\n");
    utimesSync(test, now / 1000, now / 1000);

    expect(said(from)).toEqual([]);
  });
});
