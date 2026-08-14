import { Component } from "../framework";
import { Header } from "./header";

/** Reached from both chunks and from neither the root nor anything the root reaches. */
export class Shared extends Component {
  render() {
    return <Header />;
  }
}
