import { StableProps, Component, Host, bootstrap, compute, state } from "../framework";

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
    return (
      <div>
        {/* REPORTED — a fresh object every render. */}
        <Row conf={{ dense: true }} label="a" />
        {/* Not reported: `conf` is declared a value, so the literal costs nothing. */}
        <Settled conf={{ dense: true }} label="settled" />
        {/* Not reported either: the declaration is inherited. */}
        <SettledBase conf={{ dense: true }} label="inherited" />
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
