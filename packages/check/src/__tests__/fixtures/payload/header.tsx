import { Component } from "../framework";

/** Written in the first payload, so a chunk reaching it downloads nothing. */
export class Header extends Component {
  render() {
    return <h1>x</h1>;
  }
}
