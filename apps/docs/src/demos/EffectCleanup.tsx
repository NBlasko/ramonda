import { Component, Host, state, effect } from "@ramonda/core";

// An @effect runs after the DOM is committed, and again whenever a signal it
// READ changes. Return a function and it becomes the cleanup.
//
// That is the whole contract, and it works on both ends: the cleanup runs before
// the effect re-runs, and once more when the component is destroyed. Here the
// effect reads `channel`, so switching channels disconnects the old one first —
// exactly what an external subscription needs.
@Host("div")
export class EffectCleanup extends Component {
  @state channel = "news";
  @state log: string[] = [];

  @effect
  connect() {
    const channel = this.channel;
    this.append(`connected to ${channel}`);
    return () => this.append(`disconnected from ${channel}`);
  }

  // Not reactive state the effect reads — writing to a signal the effect READS
  // would make it re-run forever.
  private append(line: string) {
    this.log = [...this.log, line].slice(-4);
  }

  switchTo(next: string) {
    this.channel = next;
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          {["news", "sport", "weather"].map((name) => (
            <button type="button" disabled={this.channel === name} onClick={() => this.switchTo(name)}>
              {name}
            </button>
          ))}
        </p>
        {/*
          `.map()` is fine here and the docs say so: this list is append-only
          display text with no state and no reordering, so there is no identity
          to preserve. See "What .map() costs you" on the Lists page.
        */}
        <ul className="demo-log">
          {this.log.map((line) => (
            <li>{line}</li>
          ))}
        </ul>
      </div>
    );
  }
}
