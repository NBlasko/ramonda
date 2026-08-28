import { Component, state, onWindow, mounted } from "@ramonda/core";

// @onWindow attaches a listener for the component's lifetime and removes it on
// unmount — there is no cleanup to remember and no way to leak one.
//
// It is built on the effect primitive, so it is CLIENT ONLY: during a server
// render nothing is attached and nothing is measured. That is why the first
// value is read in @mounted({ env: "client" }) rather than in a field initializer,
// which would run on the server where there is no window to measure.
export class WindowSize extends Component {
  @state width = 0;

  @mounted({ env: "client" })
  readInitial() {
    this.width = window.innerWidth;
  }

  @onWindow("resize")
  onResize(_event: UIEvent) {
    this.width = window.innerWidth;
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          <span>
            window is <strong>{this.width}px</strong> wide
          </span>
          <span className="demo-note">resize the browser</span>
        </p>
      </div>
    );
  }
}
