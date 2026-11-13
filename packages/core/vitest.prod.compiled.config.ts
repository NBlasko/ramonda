import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import { ramonda } from "@ramonda/build/vite";
import base from "./vitest.prod.config";

/** The plugins `ramonda()` returns, by name: the base config's, with `compile: false`, are replaced. */
const RAMONDA = new Set(ramonda().map((plugin) => plugin.name));
const named = (plugin: unknown): string | undefined => (plugin as { name?: string } | null)?.name;
const every = (plugins: unknown): unknown[] => [plugins ?? []].flat(Number.POSITIVE_INFINITY);

/**
 * The production suite again, through the JSX compiler — what a production build of an app ships, with
 * `__DEV__` false and every tree it can take a template. Beside `vitest.compiled.config.ts`, which is the
 * same for the development suite.
 */
const config = mergeConfig(
  { ...base, plugins: every(base.plugins).filter((plugin) => !RAMONDA.has(named(plugin) ?? "")) },
  defineConfig({ plugins: [ramonda()], test: { coverage: { enabled: false }, env: { RAMONDA_COMPILED: "1" } } }),
);

// Asked of the merged config: a second settings plugin would run its hooks, and lower decorators, twice.
const settings = every(config.plugins).filter((plugin) => named(plugin) === "ramonda").length;
if (settings !== 1)
  throw new Error(`vitest.prod.compiled.config.ts: ${settings} \`ramonda\` plugins in the merged config, not one`);

export default config;
