import { Component } from "@ramonda/core";
import { ThemeConsumer, ThemeProvider } from "./contexts";

/** A base that CONSUMES. Its fields construct first, so a subclass's Provider is below it. */
export class ReadsOnTheBase extends Component {
  outer = this.use(ThemeConsumer);
  render() {
    return null;
  }
}

/** A base that PROVIDES. The ordinary arrangement, and it must stay silent. */
export class ProvidesOnTheBase extends Component {
  own = this.use(ThemeProvider, () => ({ color: "amber" }));
  render() {
    return null;
  }
}
