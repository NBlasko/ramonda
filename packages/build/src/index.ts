/**
 * The settings themselves, for a bundler this package has no adapter for.
 *
 * The adapters live behind their own entry points — `@ramonda/build/vite` and
 * `@ramonda/build/esbuild` — so that installing one does not drag the other's types along.
 *
 * If you are wiring up something else, {@link RAMONDA_TRANSFORM} is the whole answer,
 * {@link lowersDecorators} is how to tell whether what you wired up will work, and
 * {@link PUBLIC_ENV_PREFIX} / {@link publicEnv} are what decides which environment variables may
 * reach the browser.
 */
export { PUBLIC_ENV_PREFIX, RAMONDA_TRANSFORM, lowersDecorators, publicEnv } from "./settings";
