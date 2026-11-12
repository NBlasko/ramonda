import { defineConfig, mergeConfig } from "vite";
import { ramonda } from "@ramonda/build/vite";
import base from "./vite.config";

/** The plugins `ramonda()` returns, by name: the base config's, with `compile: false`, are replaced. */
const RAMONDA = new Set(ramonda().map((plugin) => plugin.name));
const named = (plugin: unknown): string | undefined => (plugin as { name?: string } | null)?.name;
const every = (plugins: unknown): unknown[] => [plugins ?? []].flat(Number.POSITIVE_INFINITY);

/**
 * The whole suite again, with every JSX tree the compiler can take built as a template and holes (see
 * `@ramonda/build`'s `compile.ts`) — part of `test`, beside the suite as the runtime is written.
 */
const config = mergeConfig(
  // `ramonda()` is a list, so the base's sits in `plugins` as an array of its own.
  { ...base, plugins: every(base.plugins).filter((plugin) => !RAMONDA.has(named(plugin) ?? "")) },
  defineConfig({ plugins: [ramonda()], test: { coverage: { enabled: false }, env: { RAMONDA_COMPILED: "1" } } }),
);

// Asked of the merged config: a second settings plugin would run its config hooks, and on Vite 8 lower
// every module's decorators, twice.
const settings = every(config.plugins).filter((plugin) => named(plugin) === "ramonda").length;
if (settings !== 1)
  throw new Error(`vitest.compiled.config.ts: ${settings} \`ramonda\` plugins in the merged config, not one`);

export default config;
