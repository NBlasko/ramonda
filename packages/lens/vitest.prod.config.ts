import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.mjs";
import { hookTimeout, testTimeout } from "../../vitest.timeout.mjs";

/**
 * The production test run, and the reason it exists is a gap this package had until its first release.
 *
 * Every warning in `apply.ts` is behind `if (__DEV__)`, and the ordinary suite runs with `__DEV__`
 * true — so the code path a published app actually takes was never executed by a test. That is the same
 * shape as a bug core shipped once: an early return outside the guard leaked every diagnostic into
 * production, and only a build test found it.
 *
 * The flag is pinned to `false` here rather than read from the environment. Core's equivalent config
 * passes the expression `process.env.NODE_ENV !== "production"`, and this Vite rejects that —
 * `Invalid define value (must be an entity name or JS literal)` — which is just as well: a config whose
 * only job is the production path should say so, and the file's first assertion checks the flag anyway.
 */
export default defineConfig({
  define: {
    __DEV__: "false",
  },
  test: {
    coverage,
    testTimeout,
    hookTimeout,
    globals: true,
    include: ["src/**/*.prod.test.ts"],
  },
});
