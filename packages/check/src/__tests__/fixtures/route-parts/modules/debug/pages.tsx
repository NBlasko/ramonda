import { Component } from "@ramonda/core";
import { Navigator } from "../../router";

/** REPORTED: reached through BOTH arms of a condition's part — the DEV arm here — and `/debug` has no `:nope`. */
export class DebugPage extends Component {
  nav = this.use(Navigator);
  render() {
    return <pre>{this.nav.params("/debug/:nope").nope}</pre>;
  }
}
