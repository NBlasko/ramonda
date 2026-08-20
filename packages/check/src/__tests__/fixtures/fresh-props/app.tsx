import { StableProps, Component, Host, bootstrap, compute, state } from "../framework";

import { arrowConf, chainConf, chainShared, deepConf, loopConf, maybeConf, makeConf, sharedConf } from "./make";

declare const rest: Record<string, unknown>;

const STABLE = { dense: true };

@Host("li")
/**
 * A component that DECLARES the prop a value. The literal at the call site is then the documented
 * way to write it: the framework compares by content and hands back the identity it already had.
 */
@StableProps("conf")
class Settled extends Component<{ conf: unknown; label: string }> {
  render() {
    return <li />;
  }
}

/** The declaration merges along the chain, so a base settles a subclass's props too. */
class SettledBase extends Settled {}

class Row extends Component<{ conf: unknown; tags: unknown; label: string }> {
  render() {
    return <li>{this.props.label}</li>;
  }
}

/**
 * Object and array literals in props, beside every shape that must not be reported.
 *
 * The host-element half is the one that matters most: `<div style={{…}}>` is written constantly and
 * is not this fault at all — nothing is handed to a component, so there is no comparison to defeat.
 */
@Host("div")
class Table extends Component {
  @state dense = false;

  @compute get conf() {
    return { dense: this.dense };
  }

  render() {
    const local = { dense: true };
    return (
      <div>
        {/* REPORTED — a fresh object every render. */}
        <Row conf={{ dense: true }} label="a" />
        {/* REPORTED — the same fresh object, built one line earlier. */}
        <Row conf={local} label="local" />
        {/* REPORTED — built by a helper in another file, which `resolve` follows. */}
        <Row conf={makeConf()} label="helper" />
        {/* Not reported: the helper hands back one object it built once, which is a stable reference. */}
        <Row conf={sharedConf()} label="shared" />
        {/* Not reported: `conf` is declared a value, so the literal costs nothing. */}
        <Settled conf={{ dense: true }} label="settled" />
        {/* Not reported either: the declaration is inherited. */}
        <SettledBase conf={{ dense: true }} label="inherited" />
        {/* REPORTED — a helper calling a helper; the report names `level3`, where the literal is. */}
        <Row conf={chainConf()} label="chain" />
        {/* REPORTED — twelve hops deep, named for `deep12` where the literal is. */}
        <Row conf={deepConf()} label="deep" />
        {/* Not reported: recursion hands back nothing, and the walk terminates on the cycle guard. */}
        <Row conf={loopConf()} label="loop" />
        {/* Not reported: the chain ends at a held object, so the whole chain is a stable reference. */}
        <Row conf={chainShared()} label="chain-shared" />
        {/* REPORTED — a helper written as an arrow is the same helper. */}
        <Row conf={arrowConf()} label="arrow" />
        {/* REPORTED — one path of it builds a fresh object, and that path is the whole fault. */}
        <Row conf={maybeConf(true)} label="maybe" />
        {/* REPORTED — a cast is not a defence; the same object is built either way. */}
        <Row conf={makeConf() as { dense: boolean }} label="cast" />
        {/* REPORTED — an array is the same fault. */}
        <Row tags={["new", "hot"]} label="b" />

        {/* Not reported: the same object every render. */}
        <Row conf={STABLE} label="c" />
        {/* Not reported: a `@compute` hands back the same object until something it reads changes. */}
        <Row conf={this.conf} label="d" />
        {/* Not reported: a HOST element hands nothing to a component, so nothing is compared. */}
        <div style={{ color: "red" }} data-x={[1, 2]}>
          plain
        </div>
        {/* Not reported: `key` and `ref` are read by the framework rather than passed on. */}
        <Row key={"k"} label="e" />
        {/* Not reported: a spread may carry anything, so no rule is handed this element. */}
        <Row conf={{ dense: true }} {...rest} label="f" />
      </div>
    );
  }
}

bootstrap(<Table />, null);
