import { Component, Host, state, Timer } from "@ramonda/core";

// A timer the app arms. `@timeout` fires relative to MOUNT, so it cannot express this:
// the clock starts on the click. `Timer` can, and teardown still clears it — navigate away
// mid-countdown and nothing fires, where a bare setTimeout would write into a component
// that is gone (RMD008 drops the write, so the symptom is a handler that does nothing).
//
// One hook instance is one timer, so `stop()` has no question of "which", and arming it
// again restarts it — press start twice and it still lands once, 3s after the second press.
@Host("div")
export class TimerOnClick extends Component {
  @state status = "nothing armed";
  // Whether a timer is waiting right now, so `cancel` can say what it actually did. A readout that
  // claims "cancelled" over a timer that already fired teaches the wrong thing, and in a demo the
  // readout IS the lesson.
  @state armed = false;
  private countdown = this.use(Timer);

  start() {
    this.armed = true;
    this.status = "armed — 3s to go";
    this.countdown.after(3000, () => {
      this.armed = false;
      this.status = "fired";
    });
  }

  cancel() {
    this.countdown.stop();
    this.status = this.armed ? "cancelled before it fired" : "nothing was armed to cancel";
    this.armed = false;
  }

  render() {
    return (
      <p className="demo-row">
        <button type="button" onclick={this.start}>
          start
        </button>
        <button type="button" onclick={this.cancel}>
          cancel
        </button>
        <span className="demo-note">{this.status}</span>
      </p>
    );
  }
}
