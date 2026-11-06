import { Component, Hook, bootstrap, compute, state } from "@ramonda/core";

/**
 * Values a CALL or a `new` builds during the render — each one reported by the runtime's RMD020 or
 * RMD022, and each one the checker was silent on until it was measured shape by shape.
 */
class Row extends Component<{ conf: unknown; on?: unknown }> {
  render() {
    return <li />;
  }
}

class Taker extends Hook<{ conf: unknown; n: number }> {}
class Fetcher extends Hook<{ fetch: () => unknown; n: number }> {}

class Reported extends Component {
  @state items = [1, 2, 3];
  @state tick = 0;
  conf = { dense: true };
  save() {}

  // REPORTED — through the parameter, as the docs write it.
  taker = this.use(Taker, (self: Reported) => ({ conf: self.items.filter((n) => n > 1), n: self.tick }));

  // REPORTED — a function built in the bag, an arrow and a method, in a callback that runs again.
  arrow = this.use(Fetcher, (self: Reported) => ({ fetch: () => self.save(), n: self.tick }));
  method = this.use(Fetcher, (self: Reported) => ({
    fetch() {
      return 1;
    },
    n: self.tick,
  }));

  // Not reported: a method handed over keeps one identity.
  handed = this.use(Fetcher, (self: Reported) => ({ fetch: self.save, n: self.tick }));

  // Not reported: a callback that reads nothing is called once, and its function never changes.
  once = this.use(Fetcher, () => ({ fetch: () => 1, n: 0 }));

  render() {
    return (
      <ul>
        <Row conf={this.items.filter((n) => n > 1)} />
        <Row conf={this.items.map((n) => n * 2)} />
        <Row conf={this.items.slice()} />
        <Row conf={this.items.concat([4])} />
        <Row conf={Object.assign({}, this.conf)} />
        <Row conf={Object.keys(this.conf)} />
        <Row conf={Array.from(this.items)} />
        <Row conf={structuredClone(this.conf)} />
        <Row conf={new Date(0)} />
        <Row conf={new Map()} />
        <Row conf={this.conf} on={this.save.bind(this)} />
      </ul>
    );
  }
}

/** The same calls where nothing is rebuilt. */
class Silent extends Component {
  @state items = [1, 2, 3];
  conf = { dense: true };

  @compute get visible() {
    return this.items.filter((n) => n > 1);
  }

  render() {
    return (
      <ul>
        {/* A @compute hands back the same array until `items` changes. */}
        <Row conf={this.visible} />
        {/* `assign` into something held hands back what is held. */}
        <Row conf={Object.assign(this.conf, { dense: false })} />
        {/* Children built from the array are compared by content, not by identity. */}
        {this.items.map((n) => (
          <Row key={n} conf={this.conf} />
        ))}
      </ul>
    );
  }
}

bootstrap(
  <>
    <Reported />
    <Silent />
  </>,
  null,
);
