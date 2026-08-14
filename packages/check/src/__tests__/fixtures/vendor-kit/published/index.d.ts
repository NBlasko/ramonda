import type { Component } from "../../framework";

export declare class Router extends Component {}
export declare class RouteOutlet extends Component {}
export declare class Link extends Component {}

/**
 * The shape the real `@ramonda/router` publishes: two members NAME their class, and two are wrapped
 * so the class identity is gone from the type. Both halves have to resolve, or the fix only covers
 * the members that happen to be spelled the easy way.
 *
 * `Sidebar` and `Panel` are handed over WITHOUT being exported, which is the ordinary case for a
 * kit — the factory is the door, so the entry names nothing. `Panel` is declared twice inside the
 * package, which is what the fragment records and what makes the name unanswerable.
 */
export interface Kit {
  Router: typeof Router;
  RouteOutlet: typeof RouteOutlet;
  Link: { new (): Component; readonly __isComponent: true };
  Sidebar: { new (): Component; readonly __isComponent: true };
  Panel: { new (): Component; readonly __isComponent: true };
  route: (pattern: string) => string;
}

export declare function createRouter(routes: unknown): Kit;
