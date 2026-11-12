import base from "./vitest.config.ts";

/** A run that opted out of the cleanup after each test and calls it by hand — see `optedOut.test.ts`. */
export default {
  ...base,
  test: {
    ...base.test,
    setupFiles: [],
    include: ["src/__tests__/opted-out/**/*.test.tsx"],
    exclude: ["**/node_modules/**"],
    coverage: { enabled: false },
  },
};
