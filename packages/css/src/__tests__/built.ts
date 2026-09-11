/**
 * The freshness check, re-exported so the tests and the `.mjs` probes share ONE copy — see
 * `built.mjs` at the package root, which holds the reasoning and the measurement.
 */
// @ts-expect-error — plain JavaScript at the package root, so the probes can import it too.
export { builtFromThisSource } from "../../built.mjs";
