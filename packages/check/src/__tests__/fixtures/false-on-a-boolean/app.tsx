import { Component, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;
declare const off: boolean;
const NO = "false";

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ The control is disabled, and the line says it is not. */}
        <button type="button" disabled="false">
          Save
        </button>
        {/* ✗ The form will not submit without it. */}
        <input type="text" aria-label="Name" required="false" />
        {/* ✗ The same string one NAME away. */}
        <input type="checkbox" aria-label="Agree" checked={NO} />

        {/* ✓ The boolean itself, which is what removes the attribute. */}
        <button type="button" disabled={false}>
          Save
        </button>
        {/* ✓ A condition, which is the same fact at runtime. */}
        <input type="text" aria-label="Name" required={off} />
        {/* ✓ `"true"` is present and ON, which is what it says. */}
        <input type="text" aria-label="Name" required="true" />

        {/* ✓ Not a boolean attribute: an ARIA state is an enumerated string. */}
        <div aria-hidden="false">x</div>
        {/* ✓ Nor is a plain one. */}
        <div data-open="false">x</div>

        {/* ✓ A spread may replace it. */}
        <input type="text" aria-label="Name" required="false" {...rest} />
      </div>
    );
  }
}

bootstrap(<App />, null);
