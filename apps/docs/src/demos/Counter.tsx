import { Component, state } from "@ramonda/core";

export class Counter extends Component {
  @state count = 0;

  increment() {
    this.count = this.count + 1;
  }

  render() {
    return <button onclick={this.increment}>count is {this.count}</button>;
  }
}
