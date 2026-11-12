import base from "./vitest.config.ts";

/**
 * A runner with no globals, so no `afterEach` this package can hook — see `noGlobals.test.ts`. The
 * base setup file is left out: it is written for a run that has them.
 */
export default {
  ...base,
  test: {
    ...base.test,
    globals: false,
    setupFiles: [],
    include: ["src/__tests__/no-globals/**/*.test.tsx"],
    exclude: ["**/node_modules/**"],
    coverage: { enabled: false },
  },
};
