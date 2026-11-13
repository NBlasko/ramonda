import { defineConfig } from "vitest/config";
import { hookTimeout, testTimeout } from "../../vitest.timeout.mjs";

// The shared deadline, as `@ramonda/check` has it: each test starts the real server and builds a program.
export default defineConfig({
  test: { testTimeout, hookTimeout },
});
