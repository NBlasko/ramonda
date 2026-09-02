import { Component, Hook, StableProps, bootstrap, compute, createContext, state } from "@ramonda/core";

import { InstalledHook } from "./installed";

const [BaseProvider, Consumer] = createContext({ conf: { dense: false }, n: 0 });

/**
 * A SECOND pair, so the consumer this component reads from is not the one it also provides.
 *
 * With one pair it consumed at `upstream` and provided at `e`, in that order — which is a real
 * `context-consumed-above-its-provider` fault, and one this fixture is not about. It was invisible
 * until every fixture began importing the framework as `@ramonda/core`: `context-pair` identifies a
 * pair by the module it came from, so a relative import hid the pair and silenced the rule.
 */
const [UpstreamProvider, UpstreamConsumer] = createContext({ conf: { dense: false }, n: 0 });
void UpstreamProvider;

/** A provider with the key DECLARED on a subclass, which is how it had to be said before. */
@StableProps("conf")
class SettledProvider extends BaseProvider {}

/** The same declaration made where the context is CREATED, which is what the docs teach now. */
const [SettledAtCreation, AtCreationConsumer] = createContext(
  { conf: { dense: false }, n: 0 },
  { stableProps: ["conf"] },
);
void AtCreationConsumer;

/** A hook of our own, whose source is in front of the rule. */
class Plain extends Hook<{ conf: unknown; n: number }> {}

@StableProps("conf")
class Settled extends Hook<{ conf: unknown; n: number }> {}

class Reporting extends Component<{ id: string }> {
  @state tick = 0;
  plain = 1;
  upstream = this.use(UpstreamConsumer);

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
  k = this.use(UpstreamConsumer);

  // Not reported: the context declared the key where it was created, and the rule reads that too.
  l = this.use(SettledAtCreation, () => ({ conf: { dense: true }, n: this.tick }));

  render() {
    return <li>{this.tick}</li>;
  }
}

bootstrap(<Reporting id="x" />, null);
