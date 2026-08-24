import type { Component } from "@ramonda/core";

/**
 * The router's own members, in a module of their own so a fixture can IMPORT them.
 *
 * Declared locally in this file rather than in the shared framework stub because the outlet is a
 * CLASS, and one more class there is one more component in every other fixture's count.
 */
export declare class RouteOutlet extends Component {
  props: { routes: unknown };
}

/** The typed kit. `createRouter` hands its members back, and an app is free to rename them. */
export declare function createRouter(routes: unknown): { RouteOutlet: typeof RouteOutlet };
