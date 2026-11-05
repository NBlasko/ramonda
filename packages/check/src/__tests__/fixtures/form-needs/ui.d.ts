import { Component } from "@ramonda/core";
/** A component whose render this cannot read — a declaration with no body, as from a package. */
export declare class Fancy extends Component<{ label: string }> {}

/** A field a package renders, with a render this cannot read. */
export declare class LibField extends Component {
  render(): unknown;
}
