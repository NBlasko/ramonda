import { Component, Hook, StableProps, bootstrap, compute, createContext, state } from "../framework";

import { InstalledHook } from "./installed";

const [BaseProvider, Consumer] = createContext({ conf: { dense: false }, n: 0 });

/** A provider with the key DECLARED, which is how a context pair takes the declaration. */
@StableProps("conf")
class SettledProvider extends BaseProvider {}

/** A hook of our own, whose source is in front of the rule. */
class Plain extends Hook<{ conf: unknown; n: number }> {}

@StableProps("conf")
class Settled extends Hook<{ conf: unknown; n: number }> {}

class Reporting extends Component<{ id: string }> {
  @state tick = 0;
  plain = 1;
  upstream = this.use(Consumer);

  @compute get n() {
    return this.tick + 1;
  }

  // REPORTED — the callback reads `@state`, so it runs again and rebuilds the literal.
  a = this.use(Plain, () => ({ conf: { dense: true }, n: this.tick }));

  // REPORTED — a `@compute` is a signal like any other.
  b = this.use(Plain, () => ({ conf: { dense: true }, n: this.n }));

  // REPORTED — every prop is a signal.
  c = this.use(Plain, () => ({ conf: { dense: true }, n: this.props.id.length }));

  // REPORTED — a field holding another hook: its props and state are signals too.
  d = this.use(Plain, () => ({ conf: { dense: true }, n: this.upstream.n }));

  // REPORTED — an array is the same fault, and a Provider is the case that matters most.
  e = this.use(BaseProvider, () => ({ conf: ["a", "b"], n: this.tick }));

  // Not reported: the callback reads nothing, so it is called once at mount and the literal
  // keeps one identity for the life of the component.
  f = this.use(Plain, () => ({ conf: { dense: true }, n: 0 }));

  // Not reported: a plain field is not a signal, so nothing can make the callback run again.
  g = this.use(Plain, () => ({ conf: { dense: true }, n: this.plain }));

  // Not reported: the hook DECLARED the key a value, which is the answer to this report.
  h = this.use(Settled, () => ({ conf: { dense: true }, n: this.tick }));

  // Not reported either: a Provider takes the declaration on a subclass.
  i = this.use(SettledProvider, () => ({ conf: { dense: true }, n: this.tick }));

  // Not reported: reached through a `.d.ts`, which carries no decorators — a declaration there
  // cannot be seen, so its absence cannot be proved.
  j = this.use(InstalledHook, () => ({ conf: { dense: true }, n: this.tick }));

  // Not reported: a hook with no callback at all.
  k = this.use(Consumer);

  render() {
    return <li>{this.tick}</li>;
  }
}

bootstrap(<Reporting id="x" />, null);
