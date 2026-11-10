import { defineConfig, mergeConfig } from "vite";
import { ramonda } from "@ramonda/build/vite";
import base from "./vite.config";

/**
 * The whole suite again, with every JSX tree the compiler can take built as a template and holes (see
 * `@ramonda/build`'s `compile.ts`) — part of `test`, beside the suite as the runtime is written.
 */
export default mergeConfig(
  { ...base, plugins: (base.plugins ?? []).filter((p) => (p as { name?: string })?.name !== "ramonda") },
  defineConfig({ plugins: [ramonda()], test: { coverage: { enabled: false }, env: { RAMONDA_COMPILED: "1" } } }),
);
