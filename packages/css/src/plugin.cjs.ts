import { NO_COMPILER, init } from "./plugin";

/**
 * The CommonJS entry, and the whole reason it exists is one measurement.
 *
 * `tsserver` requires a plugin synchronously and then checks `typeof factory === "function"`. On
 * Node 24 `require()` of an ESM module succeeds — and returns the module NAMESPACE, which is an
 * object. So an ESM-only plugin is skipped with "did not expose a proper factory function", logged
 * at info level, where nobody reads it. A plugin that quietly does nothing is worse than one that
 * fails to install.
 *
 * A default export, which esbuild emits as `module.exports = …` when it targets CommonJS and the
 * module has nothing else — `export =` would say it more directly and TypeScript refuses it under
 * `module: ESNext`, which is what the rest of this package needs.
 */
/**
 * The factory, with one constant hung on it.
 *
 * `tsserver` checks `typeof factory === "function"` and nothing else, so a property is free — and
 * the extension's shim needs {@link NO_COMPILER} to tell this plugin that IT is the copy answering.
 * The two live in different packages, and a string written out in both is a string that can drift.
 */
const factory = init as typeof init & { NO_COMPILER: typeof NO_COMPILER };
factory.NO_COMPILER = NO_COMPILER;

export default factory;
