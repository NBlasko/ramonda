import base from "./vitest.config.ts";

/**
 * Runs the fixtures that are MEANT to fail — see `failOnDiagnostics.test.tsx`. Spread rather than
 * `mergeConfig`, which concatenates arrays: the base config's `exclude` would keep the fixtures out.
 */
export default {
  ...base,
  test: {
    ...base.test,
    include: ["src/__tests__/fixtures/**/*.test.tsx"],
    exclude: ["**/node_modules/**"],
    coverage: { enabled: false },
  },
};
