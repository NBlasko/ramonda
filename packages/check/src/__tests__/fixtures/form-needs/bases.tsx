import { Component } from "@ramonda/core";

declare const value: string;
declare const typed: (event: Event) => void;

/** A field in a base class, reached from another module as `bases.NamedBase`. */
export class NamedBase extends Component {
  render() {
    return <input aria-label="named base" value={value} oninput={typed} />;
  }
}
