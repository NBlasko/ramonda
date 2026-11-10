import { expect, test, vi } from "vitest";

/**
 * The compiler — and the native parser it brings — is loaded on the first module it reads, so a build
 * with `compile: false` never loads it: on a machine without the parser's binary, ruling the compiler out
 * is what still works. Here the parser is one that refuses to load.
 */
vi.mock("oxc-parser", () => {
  throw new Error("the parser was loaded");
});

test("neither plugin loads the parser to be configured, or with `compile: false`", async () => {
  const [{ ramonda: vite }, { ramonda: esbuild }] = await Promise.all([import("../vite"), import("../esbuild")]);
  const [, compiler] = vite({ compile: false });
  const loaded = await compiler.transform.handler.call(
    undefined,
    "export const view = <p>{1}</p>;\n",
    "/app/src/view.tsx",
  );
  esbuild({ compile: false }).setup({ initialOptions: {}, onLoad: () => undefined });
  expect(loaded).toBeNull();
});
