import { Component, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;

class App extends Component {
  render() {
    return (
      <div>
        {/* The descendant SPREADS — `rest` may carry the `tabIndex={-1}` that settles it. */}
        <div aria-hidden="true">
          <button {...rest}>Save</button>
        </div>

        {/* The same question asked of the element ITSELF, which does guard. */}
        <button aria-hidden="true" {...rest}>
          Save
        </button>
      </div>
    );
  }
}

bootstrap(<App />, null);
