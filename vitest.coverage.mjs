/**
 * What "coverage" means in this repository, decided once.
 *
 * Every package's vitest config spreads this in, so the published badge has a single
 * definition behind it. Six copies of these globs would drift, and a percentage that
 * means something slightly different per package is a percentage that means nothing.
 *
 * `include` is the load-bearing line. Without it, v8 reports only the files a test
 * imported — a module nobody touches is not 0% covered, it is ABSENT, and the
 * percentage silently rises. Measured on @ramonda/lens: adding one never-imported
 * file with three branches moved statements from 80.41% to 78.77% only once `include`
 * was set; without it the new file left the number exactly where it was. A badge fed
 * by the second reading advertises the tests you happened to write, not the code you
 * ship.
 */
export const coverage = {
  provider: "v8",

  // Everything under src/, whether a test reached it or not.
  include: ["src/**"],

  exclude: [
    // The tests themselves. Covering the tests with the tests is circular, and it
    // inflates the number by exactly the amount of test code you write.
    "src/**/__tests__/**",
    "src/**/*.test.{ts,tsx}",
    // Test SUPPORT — setup files and helpers (core/query/router each have src/test/).
    // Note this is `src/test/`, not `src/testing.ts`: the latter is core's published
    // `@ramonda/core/testing` entry point, which users import and which therefore
    // counts like any other shipped module.
    "src/test/**",
    // Types erase at compile time: there is no statement to execute, so these would
    // sit at 0% forever and drag the total down for no defect.
    "src/**/*.d.ts",
    "src/**/types.ts",
  ],

  // `text-summary` for a human reading CI logs; `lcov` because that is what Coveralls
  // ingests. Written to <package>/coverage/, which turbo declares as this task's
  // output and .gitignore keeps out of the tree.
  reporter: ["text-summary", "lcov"],
  reportsDirectory: "coverage",
};

/**
 * The same settings, plus a FLOOR the run has to clear.
 *
 * What this catches is the failure nothing else does: code added to a package without tests, which
 * every gate passes — it compiles, it lints, the suite is green — while the number quietly drops and
 * the next reader assumes the percentage still means what it used to. A badge nobody has to defend
 * stops being evidence.
 *
 * **A floor, not a target.** Set it a point or so under what the package measures TODAY, so ordinary
 * work does not fight it and a real slide does. Raising it is a deliberate commit of its own; a PR
 * that has to lower it is the conversation this exists to start.
 *
 * **Per package, and per RUN.** One number across the repo would have to be the weakest package's,
 * which is no floor at all for the strongest — so each package spreads its own, and a package with
 * none set is simply not floored yet. The `test:prod` runs keep the bare `coverage`: they execute
 * only `*.prod.test.*`, so they cover the production-only branches and nothing else, and asking them
 * for a whole package's number would be asking the wrong question.
 *
 * **Lines only.** Branches and functions move for reasons that are not a loss of testing — a guard
 * split in two, a callback extracted — and a gate that fires on those gets turned off.
 */
export function withFloor(lines) {
  return { ...coverage, thresholds: { lines } };
}
