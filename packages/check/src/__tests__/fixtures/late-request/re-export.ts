/**
 * The framework's own `requestContext`, handed on under this module's name.
 *
 * An app that wraps its imports in a module of its own is doing something ordinary, and the
 * function it re-exports is still the framework's — the scope it reads is cleared at the same
 * moment.
 */
export { requestContext } from "@ramonda/core";
