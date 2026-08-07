import { Component, Host, state, interval, mounted } from "@ramonda/core";

// @interval runs the method every `ms` and clears the timer on unmount. In DEV a
// timer still running after its component is gone is reported as RMD006 — but
// with @interval there is nothing to get wrong.
//
// The clock is read in @mounted({ env: "client" }), not in the field initializer:
// a time rendered on the server would not match the time on the client, and
// hydration would report the mismatch (RMD007). This is the prescribed two-pass
// pattern — render something stable, fill it in once the client is running.
@Host("div")
export class IntervalClock extends Component {
  @state now = "";

  @mounted({ env: "client" })
  start() {
    this.tick();
  }

  @interval(1000)
  tick() {
    this.now = new Date().toLocaleTimeString();
  }

  render() {
    return (
      <p className="demo-row">
        <span>{this.now || "—"}</span>
        <span className="demo-note">updates every second</span>
      </p>
    );
  }
}
