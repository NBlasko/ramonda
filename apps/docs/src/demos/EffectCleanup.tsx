import { Component, Host, createSubscriptionDecorator, memoizedHandler, state } from "@ramonda/core";

/**
 * A subscription decorator, which is where the "return the cleanup" contract lives.
 *
 * `connect` runs once the DOM is committed, and again whenever a signal it READ changes —
 * here `owner.channel`, so switching channels disconnects the old one first, which is
 * exactly what an external subscription needs. What it returns is the cleanup: it runs
 * before the next connect, and once more when the component is destroyed.
 *
 * Annotating `owner` is what makes the concrete component reachable inside — see writing
 * your own decorators.
 */
interface ChannelFeed extends Component {
  channel: string;
}

const onChannel = createSubscriptionDecorator("onChannel", (owner: ChannelFeed, handler: (line: string) => void) => {
  const channel = owner.channel;
  handler(`connected to ${channel}`);
  return () => handler(`disconnected from ${channel}`);
});

@Host("div")
export class EffectCleanup extends Component {
  @state channel = "news";
  @state log: string[] = [];

  @onChannel()
  onLine(line: string) {
    this.append(line);
  }

  // Not state the connect READS — writing to a signal it reads would reconnect forever.
  private append(line: string) {
    this.log = [...this.log, line].slice(-4);
  }

  // `@memoizedHandler`, not an inline arrow: it caches the returned function by
  // its arguments, per instance, so the same button gets the same handler on every
  // render. A fresh one would be re-attached to the element each time (and RMD020
  // reports it).
  @memoizedHandler
  switchTo(next: string) {
    return () => {
      this.channel = next;
    };
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          {["news", "sport", "weather"].map((name) => (
            <button type="button" disabled={this.channel === name} onClick={this.switchTo(name)}>
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
