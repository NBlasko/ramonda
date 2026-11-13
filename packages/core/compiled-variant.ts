import { mergeConfig, type UserConfig } from "vite";
import { ramonda } from "@ramonda/build/vite";

/** The plugins `ramonda()` returns, by name. */
const RAMONDA = new Set(ramonda().map((plugin) => plugin.name));
const named = (plugin: unknown): string | undefined => (plugin as { name?: string } | null)?.name;
const every = (plugins: unknown): unknown[] => [plugins ?? []].flat(Number.POSITIVE_INFINITY);

/**
 * A suite's config again, through the JSX compiler: the base's `ramonda({ compile: false })` swapped for
 * `ramonda()`, coverage off, and `RAMONDA_COMPILED` set for the tests that are the `jsx()` path's alone.
 * Used by `vitest.compiled.config.ts` and `vitest.prod.compiled.config.ts`, so the two cannot drift.
 */
export function compiledVariant(base: UserConfig, file: string): UserConfig {
  const config = mergeConfig(
    // `ramonda()` is a list, so the base's sits in `plugins` as an array of its own.
    { ...base, plugins: every(base.plugins).filter((plugin) => !RAMONDA.has(named(plugin) ?? "")) as never },
    { plugins: [ramonda()], test: { coverage: { enabled: false }, env: { RAMONDA_COMPILED: "1" } } },
  );
  // Asked of the merged config: a second settings plugin would run its hooks, and lower decorators, twice.
  const settings = every(config.plugins).filter((plugin) => named(plugin) === "ramonda").length;
  if (settings !== 1) throw new Error(`${file}: ${settings} \`ramonda\` plugins in the merged config, not one`);
  return config;
}
