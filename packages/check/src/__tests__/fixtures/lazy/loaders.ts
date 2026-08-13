/**
 * A literal registry indexed by a runtime key. Every value is an arrow whose body is `import()`
 * with a string literal, which is also the only shape a bundler can code-split.
 */
export const pages: Record<string, () => Promise<unknown>> = {
  "/a": () => import("./pages/one"),
  "/b": () => import("./pages/two"),
};
