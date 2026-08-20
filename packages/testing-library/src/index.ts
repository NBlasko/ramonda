/**
 * Testing utilities for Ramonda, built on the DOM Testing Library.
 *
 * The queries, `screen`, `waitFor` and `within` are not reimplemented — they are
 * the DOM library's, re-exported. That library is framework-agnostic on purpose
 * and it is where the query semantics people already know come from; a
 * from-scratch copy would be a worse version of it that also has to be
 * maintained.
 *
 * What this package adds is the part only Ramonda can know: when a render has
 * finished. See `act`.
 */

// Everything the DOM library offers — queries, screen, waitFor, within,
// prettyDOM, configure. `fireEvent` is deliberately overridden below.
export * from "@testing-library/dom";

export { act } from "./act";
export { cleanup } from "./cleanup";
export { fireEvent } from "./fireEvent";
export { render } from "./render";
export type {
  RenderOptions,
  RenderResult,
  WrapperComponent,
} from "./render";
export { renderHook } from "./renderHook";
export type { RenderHookProps, RenderHookResult } from "./renderHook";

import { registerAutoCleanup } from "./cleanup";

// Registered at import time, which is the only way it holds: a harness rule that
// a test has to remember is a harness rule that gets forgotten. Opt out with
// `import "@ramonda/testing-library/dont-cleanup-after-each"` or the
// RAMONDA_TL_SKIP_AUTO_CLEANUP env var.
registerAutoCleanup();
