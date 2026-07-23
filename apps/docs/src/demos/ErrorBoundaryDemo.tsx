import { Component, Host, state, ErrorBoundary } from "@ramonda/core";

// A component that throws while rendering. Without a boundary the error
// propagates and takes the tree with it.
@Host("div")
class Fragile extends Component<{ crash: boolean }> {
  render() {
    if (this.props.crash) {
      throw new Error("Fragile could not render");
    }
    return <span>Fragile is fine.</span>;
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
@Host("div")
export class ErrorBoundaryDemo extends Component {
  @state crash = false;

  toggle() {
    this.crash = !this.crash;
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          <button type="button" onClick={this.toggle}>
            {this.crash ? "fix it" : "break it"}
          </button>
          <span className="demo-note">this row is outside the boundary</span>
        </p>
        <ErrorBoundary
          fallback={({ message, reset }) => (
            <p className="demo-error">
              Caught: {message}{" "}
              <button
                type="button"
                onClick={() => {
                  this.crash = false;
                  reset();
                }}
              >
                retry
              </button>
            </p>
          )}
        >
          <Fragile crash={this.crash} />
        </ErrorBoundary>
      </div>
    );
  }
}
