import { Component, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;
declare const how: string;
declare const error: string;
declare const count: number;

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ An alert made polite: the error waits for a gap that may never come. */}
        <div role="alert" aria-live="polite">
          {error}
        </div>

        {/* ✗ A status made assertive: it interrupts on every keystroke. */}
        <div role="status" aria-live="assertive">
          {count} results
        </div>

        {/* ✗ The two rarer live roles behave the same way. */}
        <div role="log" aria-live="assertive">
          x
        </div>
        <div role="timer" aria-live="assertive">
          x
        </div>

        {/* ✓ The role alone, which is the advice — it cannot disagree with itself. */}
        <div role="alert">{error}</div>
        <div role="status">{count} results</div>

        {/* ✓ Agreeing is untidy, not a fault. */}
        <div role="alert" aria-live="assertive">
          {error}
        </div>
        <div role="status" aria-live="polite">
          {count} results
        </div>

        {/* ✓ `off` is a stronger claim than a politeness — it says the region is not live at all. */}
        <div role="status" aria-live="off">
          {count}
        </div>

        {/* ✓ `aria-live` alone, with no role: one source for the politeness rather than two. */}
        <div aria-live="polite">{count} results</div>

        {/* ✓ A politeness this cannot READ may be either. */}
        <div role="alert" aria-live={how}>
          {error}
        </div>

        {/* ✓ A role that is not a live region at all. */}
        <div role="region" aria-label="Results" aria-live="polite">
          {count}
        </div>

        {/* ✓ A spread after either half may replace it. */}
        <div role="alert" aria-live="polite" {...rest}>
          {error}
        </div>

        {/* ✗ But a spread BEFORE cannot reach over either. */}
        <div {...rest} role="alert" aria-live="polite">
          {error}
        </div>
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
