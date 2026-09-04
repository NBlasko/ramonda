import { defineConfig } from "vitest/config";
import { withFloor } from "../../vitest.coverage.mjs";
import { hookTimeout, testTimeout } from "../../vitest.timeout.mjs";

export default defineConfig({
  test: {
    coverage: {
      ...withFloor(99),
      exclude: [
        ...withFloor(99).exclude,
        /**
         * The command's shell: argument parsing, printing and `process.exit`. Every decision it makes
         * is in `check.ts` and is tested there, and what is left cannot be reached in-process at all.
         *
         * Not left uncovered instead: `__tests__/cli.test.ts` runs the real bin as a subprocess and
         * asserts what a build actually depends on — the exit code and what comes out.
         */
        "src/cli.ts",
        /**
         * The two tool drivers, and the boundary is structural rather than a comment: everything
         * they could get wrong is a decision, and every decision is in `tooling.ts`, which is tested
         * with a tool that does exactly what a test says. What is left is "run this binary and read
         * what came out", covered for real by `__tests__/toolingCli.test.ts` against biome and
         * oxlint themselves.
         */
        "src/tools.ts",
      ],
    },
    testTimeout,
    hookTimeout,
    globals: true,
    // Nothing here touches a DOM: the runtime half builds a plain object and the compiler half is
    // text. A jsdom environment would only hide an accidental reach for `document`.
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
