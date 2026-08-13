/**
 * The settings themselves, for a bundler this package has no adapter for.
 *
 * The adapters live behind their own entry points — `@ramonda/build/vite` and
 * `@ramonda/build/esbuild` — so that installing one does not drag the other's types along.
 *
 * If you are wiring up something else, {@link RAMONDA_TRANSFORM} is the whole answer, and
 * {@link lowersDecorators} is how to tell whether what you wired up will work.
 */
export { RAMONDA_TRANSFORM, lowersDecorators } from "./settings";
