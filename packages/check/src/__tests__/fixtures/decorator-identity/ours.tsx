import { Component, state } from "@ramonda/core";
import { persist } from "./own";

/**
 * ✓ The app's OWN `persist`, imported under its own name, beside core's `@state`.
 *
 * It claims none of core's capabilities, so there is nothing here that adds nothing. A rule going
 * by the written NAME would report this — somebody else's code, for the framework's rule.
 */
export class OursUnderItsOwnName extends Component {
  @state
  @persist
  n = 1;
  render() {
    return null;
  }
}
