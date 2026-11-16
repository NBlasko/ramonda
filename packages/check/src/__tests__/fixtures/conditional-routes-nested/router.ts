import { Component, Hook } from "@ramonda/core";

/** The router's pieces this rule names, declared here as `params-off-route` declares its own. */
export declare class RouteOutlet extends Component {
  props: { routes: unknown };
}
export declare class Link extends Component {
  props: { href: string; children?: unknown };
}
export declare class Navigator extends Hook {
  pathname: string;
  push(href: string): void;
  replace(href: string): void;
  params(pattern?: string): Record<string, string>;
}
export declare function route(pattern: string, params: Record<string, string>): string;
