import { StableProps, Component, Host, bootstrap, compute, list, state } from "../framework";

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

  @state maybe: { dense: boolean } | null = null;

  @state rows: { id: string; conf: { dense: boolean } }[] = [];

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
        {/* REPORTED as per-row — one literal in the callback is one child per row that cannot be skipped. */}
        {this.rows.map((row) => (
          <Row conf={{ dense: true }} label={row.id} />
        ))}
        {/* REPORTED as per-row — a local inside the callback is rebuilt for each one. */}
        {list(this.rows, (row) => {
          const perRow = { dense: row.id === "x" };
          return <Row conf={perRow} label={row.id} />;
        })}
        {/* Not reported: the row itself is as stable as the array holding it. */}
        {list(this.rows, (row) => (
          <Row conf={row} label={row.id} />
        ))}
        {/* Not reported: a field of the row, same. */}
        {list(this.rows, (row) => (
          <Row conf={row.conf} label={row.id} />
        ))}
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
        {/* REPORTED — a ternary where both arms build. */}
        <Row conf={this.dense ? { dense: true } : { dense: false }} label="ternary" />
        {/* REPORTED — one arm builds, and that arm is the whole fault. */}
        <Row conf={this.dense ? { dense: true } : STABLE} label="ternary-half" />
        {/* REPORTED — the common default: a fallback literal behind `??`. */}
        <Row conf={this.maybe ?? { dense: true }} label="fallback" />
        {/* Not reported: a spread AFTER it may overwrite it, and a prop that never arrives is not this fault. */}
        <Row conf={{ dense: true }} {...rest} label="f" />
        {/* REPORTED — after the last spread, so nothing can take it away. */}
        <Row {...rest} conf={{ dense: true }} label="g" />
      </div>
    );
  }
}

bootstrap(<Table />, null);
