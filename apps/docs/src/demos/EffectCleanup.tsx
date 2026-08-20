import { Component, Host, createSubscriptionDecorator, list, memoizedHandler, state } from "@ramonda/core";

/** Module scope, so `each` is the SAME array every render — a fresh literal would be a new
 *  value each time and cost the list its identity. */
const CHANNELS = ["news", "sport", "weather"];

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

  renderChannel(name: string) {
    return (
      <button type="button" disabled={this.channel === name} onclick={this.switchTo(name)}>
        {name}
      </button>
    );
  }

  renderLine(line: string) {
    return <li>{line}</li>;
  }

  render() {
    return (
      <div>
        <p className="demo-row">{list(CHANNELS, this.renderChannel)}</p>
        <ul className="demo-log">{list(this.log, this.renderLine)}</ul>
      </div>
    );
  }
}
