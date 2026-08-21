import { Component } from "@ramonda/core";
import { ThemeProvider } from "./context";
import { Reader } from "./reader";

/** One of the two classes called `Page`. This one mounts the provider. */
export class Page extends Component {
  p = this.use(ThemeProvider);
  render() {
    return <Reader />;
  }
}
