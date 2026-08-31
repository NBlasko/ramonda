import { Component, state } from "@ramonda/core";
import { failureMessage } from "../failureMessage";

/**
 * A page for making the framework complain on purpose.
 *
 * Diagnostics are the hardest part of the framework to look at, because you only see one when you
 * have made the mistake it describes — and by then you are looking at your own bug, not at how the
 * report behaves. This page provokes them deliberately, so the badge's burst, the count, and the
 * log rows can be watched without breaking anything.
 *
 * Every button here goes through the REAL path: `diagnose()` → `ramondaLog()` → the
 * `ramonda:dev-log` event the panel listens to. Nothing is faked, which is the point — a fake would
 * drift from the thing it stands in for and would not prove the pipe works.
 *
 * Severity matters and is worth seeing: an **error** detonates the badge and adds to its count, a
 * **warning** goes to the log without shouting. RMD022 (a hook's props callback rebuilding a value)
 * is a warning, which is why the playground has been reporting it all along without the badge ever
 * lighting up.
 */
export class DiagnosticsPage extends Component {
  @state fired = 0;
  @state last = "";

  /**
   * RMD004 — a write to a component's own props.
   *
   * The most convenient error to provoke, because it needs no broken component: assigning to
   * `props` reports the diagnostic and then throws, in every build. The throw is caught here, so
   * the app carries on and the only thing left behind is the report — which is exactly what we want
   * to look at.
   */
  writeToProps() {
    try {
      // A DIFFERENT property each time, deliberately. A diagnostic is deduped by what it is about,
      // and RMD004 keys on the component plus the property — so writing to the same one twice is
      // reported once, which is right in an app and useless on a page whose job is to make the
      // count climb. Varying the property is the honest way to get a second report: it genuinely is
      // a second mistake.
      (this.props as unknown as Record<string, unknown>)[`anything${this.fired}`] = 1;
    } catch (error) {
      this.last = failureMessage(error).split(" — ")[0];
    }
    this.fired++;
  }

  /** Three at once, to see the count climb and the burst restart on each one. */
  writeThree() {
    for (let i = 0; i < 3; i++) this.writeToProps();
  }

  /**
   * A crash inside an event handler, which is what an app's own bug usually looks like.
   *
   * Rethrown after logging, so the framework's error handling is the thing on display rather than a
   * caught exception this page pretended to handle.
   */
  crash() {
    this.fired++;
    throw new Error("A deliberate crash from the diagnostics page.");
  }

  render() {
    return (
      <div className="page">
        <h2>Diagnostics</h2>
        <p className="muted">
          Make the framework complain on purpose, and watch what the badge and the log do about it. Nothing here is
          faked — each button goes through <code>diagnose()</code> and the same
          <code> ramonda:dev-log</code> event devtools listens to.
        </p>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0">
          <button onclick={this.writeToProps}>one error (RMD004)</button>
          <button onclick={this.writeThree}>three errors</button>
          <button onclick={this.crash}>throw from a handler</button>
        </div>

        <p className="muted">
          Fired: {String(this.fired)}
          {this.last ? ` · last: ${this.last}` : ""}
        </p>

        <h3>What to look for</h3>
        <ul className="muted">
          <li>
            The badge in the corner <strong>detonates</strong> — a shake, two rings and a spray of sparks — then settles
            into a red badge with a count that breathes until you open the panel. Each new error restarts the burst.
          </li>
          <li>
            The panel does <strong>not</strong> open. An error must not take the screen or reflow the app: a docked
            panel opening would change the layout the error happened in.
          </li>
          <li>
            Open it and the count clears. The <code>LOGS</code> tab has every report; click a row's data to print it to
            the console.
          </li>
          <li>
            A diagnostic is <strong>deduped</strong> by what it is about: the same mistake in the same place is reported
            once, however many times it happens. These buttons write to a different property each time precisely so each
            click is a genuinely new mistake and the count keeps climbing.
          </li>
        </ul>

        <p className="muted">
          Only the panel's own reaction is on display here. The reports themselves are stripped from a production build,
          which the framework tests by building a real app and asserting that no diagnostic code is in the output.
        </p>
      </div>
    );
  }
}
