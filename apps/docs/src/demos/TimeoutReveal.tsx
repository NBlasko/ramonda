import { Component, Host, state, timeout } from "@ramonda/core";

// @timeout runs the method once, `ms` after the component mounts, and cancels it
// if the component is destroyed first. That cancellation is the point: a bare
// setTimeout in @mount would still fire after the user navigated away, and would
// write state into a component that no longer exists (RMD008).
@Host("div")
export class TimeoutReveal extends Component {
  @state revealed = false;

  @timeout(1500)
  reveal() {
    this.revealed = true;
  }

  render() {
    return (
      <p className="demo-row">
        {this.revealed ? (
          <span>Revealed after 1.5 seconds.</span>
        ) : (
          <span className="demo-note">waiting 1.5 seconds…</span>
        )}
      </p>
    );
  }
}
