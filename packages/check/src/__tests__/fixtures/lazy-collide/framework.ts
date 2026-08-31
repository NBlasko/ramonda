/**
 * Core, plus the one class this fixture needs.
 *
 * `AsyncLoad` is NOT in the shared `fixtures/framework.ts`, and that is deliberate: a declared class
 * there is a component in every fixture's graph, and adding it moved the node counts five other
 * tests assert. `Select` and `TextArea` are consts for the same reason. A local re-export keeps the
 * class inside the one fixture that needs it, and `@ramonda/core` still resolves to this file, so
 * the core-identity walk answers exactly as it does everywhere else.
 */
export * from "../framework";
import type { Component } from "../framework";

export declare class AsyncLoad extends Component<{
  lazy: () => Promise<unknown>;
  onLoading?: unknown;
  errorFallback?: unknown;
  cacheKey?: string;
  [attribute: string]: unknown;
}> {}
