import { Component, Hook, bootstrap, compute, persist, state } from "@ramonda/core";

class Ready extends Hook<undefined> {
  ready = true;
}
class Uses extends Hook<{ on: unknown }> {}

class Base extends Component {
  inherited = true;
}

class Reported extends Base {
  // REPORTED — a hook declared below: a TypeError at mount.
  a = this.use(Uses, (self: Reported) => ({ on: self.browser.ready }));
  // REPORTED — a plain field declared below: `undefined`, and it stays that way.
  b = this.use(Uses, (self: Reported) => ({ on: self.limit }));
  // REPORTED — `@state` declared below is undefined at that moment too.
  c = this.use(Uses, () => ({ on: this.count }));
  // REPORTED — through a destructured parameter.
  d = this.use(Uses, ({ limit }: Reported) => ({ on: limit }));
  // REPORTED — destructuring reads the field when the callback is called, even where the only use of
  // it is inside a function handed over in the bag: that function keeps the `undefined` it was given.
  e = this.use(Uses, ({ total }: Reported) => ({ on: () => total }));
  // REPORTED — `@state` with no initialiser is still made a signal at its own line, below this one.
  f = this.use(Uses, (self: Reported) => ({ on: self.pending }));
  // REPORTED — a rest element copies every field when the callback is called; `all.total` is one.
  g = this.use(Uses, ({ ...all }: Reported) => ({ on: () => all.total }));

  browser = this.use(Ready);
  limit = 10;
  total = 3;
  @state count = 0;
  @state pending?: number;

  render() {
    return <p />;
  }
}

class Silent extends Base {
  early = 5;
  ready = this.use(Ready);

  // Declared above: set by the time the callback runs.
  a = this.use(Uses, (self: Silent) => ({ on: self.early + (self.ready.ready ? 1 : 0) }));
  // A method and a getter live on the prototype, there from the start.
  b = this.use(Uses, (self: Silent) => ({ on: self.label() + self.doubled }));
  // A base class's field is set before this class's fields.
  c = this.use(Uses, (self: Silent) => ({ on: self.inherited }));
  // Read inside a function handed over in the bag: run later, when everything is set.
  d = this.use(Uses, (self: Silent) => ({ on: () => self.late }));
  // A `declare` field and one with no initialiser emit no assignment here: `props` is the base's, set
  // before this class's fields, and the other is `undefined` wherever it is declared.
  e = this.use(Uses, (self: Silent) => ({ on: self.props }));
  f = this.use(Uses, (self: Silent) => ({ on: self.typedOnly }));

  // `@persist` alone defines nothing: `draft` is `undefined` wherever it is declared.
  h = this.use(Uses, (self: Silent) => ({ on: self.draft }));
  // An inner `all` is somebody else's: only the rest copy's own binding reads too early.
  i = this.use(Uses, ({ ...all }: Silent) => ({ on: () => [all].map((all) => all.late) }));

  declare props: Record<string, unknown>;
  typedOnly: number | undefined;
  @persist draft?: string;

  late = 1;

  label() {
    return "x";
  }
  @compute get doubled() {
    return this.early * 2;
  }
  render() {
    return <p />;
  }
}

bootstrap(
  <>
    <Reported />
    <Silent />
  </>,
  null,
);
