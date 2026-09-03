// The app's OWN `createRef`, imported under that exact name. The alias in `app.tsx` does not test
// this: a plant that matched on the identifier `createRef` stayed green there, because the alias
// renamed it. Judged by where the binding came from, this file is nobody's business but its own.
import { Component } from "@ramonda/core";
import { createRef } from "./own-ref";

/** ✓ Same name, different origin. */
export class OwnCreateRefUnderItsOwnName extends Component {
  render() {
    const held = createRef<HTMLInputElement>();
    return <input ref={held as never} />;
  }
}
