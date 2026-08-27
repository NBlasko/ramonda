import { Component, state, Timeout } from "@ramonda/core";

// A scheduled call the app starts. `@timeout` fires relative to MOUNT, so it cannot express this:
// the clock starts on the click. `Timeout` can, and teardown still clears it — navigate away
// mid-countdown and nothing fires, where a bare setTimeout would write into a component that is
// gone (RMD008 drops the write, so the symptom is a handler that does nothing).
//
// `run` is declared WITH the hook, not passed to start(), so there is no function written at the
// call site and nothing for it to capture. One instance is one timer: press start twice and it
// still lands once, 3s after the second press.
export class TimerOnClick extends Component {
  @state status = "nothing started";
  // Whether a call is waiting, so `cancel` can say what it actually did. A readout that claims
  // "cancelled" over a timer that already fired teaches the wrong thing, and in a demo the readout
  // IS the lesson.
  @state waiting = false;
  private countdown = this.use(Timeout, () => ({ run: this.fire }));

  start() {
    this.waiting = true;
    this.status = "started — 3s to go";
    this.countdown.start(3000);
  }

  cancel() {
    this.countdown.stop();
    this.status = this.waiting ? "cancelled before it fired" : "nothing was waiting to cancel";
    this.waiting = false;
  }

  private fire() {
    this.waiting = false;
    this.status = "fired";
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          <button type="button" onclick={this.start}>
            start
          </button>
          <button type="button" onclick={this.cancel}>
            cancel
          </button>
          <span className="demo-note">{this.status}</span>
        </p>
      </div>
    );
  }
}
