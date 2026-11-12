import { defineConfig, mergeConfig } from "vite";
import { ramonda } from "@ramonda/build/vite";
import base from "./vite.config";

/** The plugins `ramonda()` returns, by name: the base config's, with `compile: false`, are replaced. */
const RAMONDA = new Set(ramonda().map((plugin) => plugin.name));
const named = (plugin: unknown): string | undefined => (plugin as { name?: string } | null)?.name;

// `ramonda()` is a list, so the base's sits in `plugins` as an array of its own.
const kept = [base.plugins ?? []].flat(Number.POSITIVE_INFINITY).filter((plugin) => !RAMONDA.has(named(plugin) ?? ""));
// Asked of what is kept, however deep: a plugin of the base's left in would run beside the compiled one.
if ([kept].flat(Number.POSITIVE_INFINITY).some((plugin) => RAMONDA.has(named(plugin) ?? ""))) {
  throw new Error(
    "vitest.compiled.config.ts: the base config's ramonda() is still in its plugins, so it would run twice",
  );
}

/**
 * The whole suite again, with every JSX tree the compiler can take built as a template and holes (see
 * `@ramonda/build`'s `compile.ts`) — part of `test`, beside the suite as the runtime is written.
 */
export default mergeConfig(
  { ...base, plugins: kept },
  defineConfig({ plugins: [ramonda()], test: { coverage: { enabled: false }, env: { RAMONDA_COMPILED: "1" } } }),
);
