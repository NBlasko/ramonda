import { Component, Hook, bootstrap, compute, state } from "@ramonda/core";

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

  browser = this.use(Ready);
  limit = 10;
  @state count = 0;

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
