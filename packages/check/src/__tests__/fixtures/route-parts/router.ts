import { Component, Hook } from "@ramonda/core";

/** The outlet and the navigator, declared here as `params-off-route` does: one more class in the shared stub is one more in every count. */
export declare class RouteOutlet extends Component {
  props: { routes: unknown };
}
export declare class Navigator extends Hook {
  pathname: string;
  params(pattern?: string): Record<string, string>;
}
