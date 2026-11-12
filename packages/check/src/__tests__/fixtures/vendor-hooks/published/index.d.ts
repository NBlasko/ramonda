import { Component, Hook } from "@ramonda/core";

export declare class Fetching extends Hook<{ key: unknown; conf: unknown; n: number }> {}
export declare class Plain extends Hook<{ conf: unknown; n: number }> {}
export declare class Grid extends Component<{ conf: unknown; label: string }> {
  render(): unknown;
}
export declare class Table extends Component<{ conf: unknown }> {
  render(): unknown;
}
