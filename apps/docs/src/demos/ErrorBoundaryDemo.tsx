import { Component, state, ErrorBoundary } from "@ramonda/core";
import type { ErrorBoundaryFallbackProps } from "@ramonda/core";

// A component that throws while rendering. Without a boundary the error
// propagates and takes the tree with it.
class Fragile extends Component<{ crash: boolean }> {
  render() {
    if (this.props.crash) {
      throw new Error("Fragile could not render");
    }
    return (
      <div>
        <span>Fragile is fine.</span>
      </div>
    );
  }
}

// ErrorBoundary catches what a subtree throws while rendering and calls
// `fallback` instead, so one broken component does not blank the page.
//
// `fallback` is a FUNCTION, not a node, and that is what makes recovery
// possible: it receives the message, the error, and a `reset` that clears the
// boundary and tries the subtree again. Everything OUTSIDE the boundary keeps
// working throughout — which is the reason to wrap the parts of a page that can
// fail independently.
export class ErrorBoundaryDemo extends Component {
  @state crash = false;

  /**
   * The boundary's own `reset`, kept from the last fallback render so the retry
   * button can be a bound method.
   *
   * A plain field, not `@state`: nothing renders it, and writing state during a
   * render is RMD001. The assignment below is idempotent, which matters because a
   * development build renders twice (RMD020).
   */
  private resetBoundary: (() => void) | undefined;

  toggle() {
    this.crash = !this.crash;
  }

  /**
   * A bound method rather than an inline arrow. `fallback` is a render prop, so an
   * arrow at the call site is a fresh prop for `ErrorBoundary` on every render —
   * which RMD020 reports, and which re-renders the boundary for nothing.
   */
  renderFallback({ message, reset }: ErrorBoundaryFallbackProps) {
    this.resetBoundary = reset;

    return (
      <p className="demo-error">
        Caught: {message}{" "}
        <button type="button" onclick={this.retry}>
          retry
        </button>
      </p>
    );
  }

  retry() {
    this.crash = false;
    this.resetBoundary?.();
  }

  render() {
    return (
      <div>
        <div>
          <p className="demo-row">
            <button type="button" onclick={this.toggle}>
              {this.crash ? "fix it" : "break it"}
            </button>
            <span className="demo-note">this row is outside the boundary</span>
          </p>
          <ErrorBoundary fallback={this.renderFallback}>
            <Fragile crash={this.crash} />
          </ErrorBoundary>
        </div>
      </div>
    );
  }
}
