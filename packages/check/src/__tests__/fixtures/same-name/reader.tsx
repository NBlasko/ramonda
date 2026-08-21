import { Component } from "@ramonda/core";
import { ThemeConsumer } from "./context";

export class Reader extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>x</span>;
  }
}
