import { defineConfig } from "vitest/config";
import { hookTimeout, testTimeout } from "../../vitest.timeout.mjs";

/**
 * The shared deadline, and nothing else.
 *
 * This package ran on vitest's 5 s default, and that default is a claim about the machine rather than
 * about the code — measured, `vite.test.ts`'s real-build case takes 282 ms of test time alone and blew
 * past 5 s inside `turbo run test`, where 46 tasks compete. See `vitest.timeout.mjs` for why the number
 * is 60 s and why a smaller multiple of today's worst case expires.
 *
 * Deliberately no other setting: the package tested correctly on the defaults, so this changes the one
 * thing that was wrong and leaves the rest where it was.
 */
export default defineConfig({
  test: { testTimeout, hookTimeout },
});
