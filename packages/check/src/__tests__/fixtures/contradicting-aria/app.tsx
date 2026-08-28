import { Component, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;
declare const busy: boolean;

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ Told optional, then the form refuses to submit. */}
        <input type="text" required aria-required="false" />

        {/* ✗ Told available, then the click does nothing. */}
        <button type="button" disabled aria-disabled="false">
          Save
        </button>

        {/* ✗ The other three pairs. */}
        <input type="checkbox" checked aria-checked="false" />
        <input type="text" readonly aria-readonly="false" />
        <details open aria-expanded="false">
          <summary>More</summary>
        </details>

        {/* ✗ `hidden` with `aria-hidden="false"`: gone from the page, announced as present. */}
        <div hidden aria-hidden="false">
          x
        </div>

        {/* ✓ Saying it TWICE is untidy, not a fault — this reports faults. */}
        <input type="text" required aria-required="true" />

        {/* ✓ The HTML attribute alone, which is the advice. */}
        <button type="button" disabled>
          Save
        </button>

        {/* ✓ Written FALSE, so there is nothing to contradict. */}
        <button type="button" disabled={false} aria-disabled="false">
          Save
        </button>

        {/* ✓ Both bound to one expression — the correct way to write a pair that moves. */}
        <button type="button" disabled={busy} aria-disabled={busy}>
          Save
        </button>

        {/* ✓ The ARIA half alone, on something with no HTML attribute to disagree with. */}
        <div role="button" tabIndex={0} aria-disabled="false">
          Save
        </div>

        {/* ✓ A spread after either half may replace it. */}
        <input type="text" required aria-required="false" {...rest} />

        {/* ✗ But a spread BEFORE cannot reach over either. */}
        <input type="text" {...rest} required aria-required="false" />
      </div>
    );
  }
}

bootstrap(
  <div>
    <App />
  </div>,
  null,
);
