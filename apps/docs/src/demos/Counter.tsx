import { Component, Host, state } from "@ramonda/core";

// The whole model in a dozen lines: a field that IS state, an ordinary method as
// the handler, and a render that reads the field. No constructor, no binding, no
// setter — `this.count = ...` is the update.
@Host("div")
export class Counter extends Component {
  @state count = 0;

  increment() {
    this.count = this.count + 1;
  }

  render() {
    return (
      <p className="demo-row">
        {/* Methods are bound for you, so passing one as a handler just works. */}
        <button type="button" onClick={this.increment}>
          count is {this.count}
        </button>
      </p>
    );
  }
}
