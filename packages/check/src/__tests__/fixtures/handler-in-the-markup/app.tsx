import { Component, StableProps, bootstrap, list, memoized, state } from "@ramonda/core";

import { arrowHandler, heldHandler, loopHandler, makeHandler } from "./make";

declare const rest: Record<string, unknown>;
declare const flag: boolean;
declare function debounce(fn: unknown, ms: number): () => void;

/** Module scope: built once, and the documented fix. */
const STABLE = () => {};

/** A component that DECLARES the prop a value, so the framework hands back the identity it had. */
@StableProps("onPick")
class Settled extends Component<{ onPick: unknown; label: string }> {
  render() {
    return <li>{this.props.label}</li>;
  }
}

/** The declaration merges along the chain, so a base settles a subclass's props too. */
class SettledBase extends Settled {}

class Row extends Component<{ onPick: unknown; label: string }> {
  render() {
    return <li>{this.props.label}</li>;
  }
}

class Panel extends Component<{ onPick?: unknown }> {
  @state rows: string[] = [];

  handlers = { save: () => {} };

  /** A field holding an arrow: ONE identity per instance, so it is stable across renders. */
  fieldArrow = () => {};

  save() {}

  other() {}

  pick(_row: string) {}

  @memoized pickRow(row: string) {
    return () => this.pick(row);
  }

  render() {
    const local = () => this.save();
    let mutable = () => this.save();
    mutable = () => this.other();

    return (
      <div>
        <button onclick={() => this.save()}>written in place</button>
        <button onclick={local}>a local one line up</button>
        <button onclick={mutable}>a let, reassigned</button>
        <button onclick={(() => this.save()) as unknown as () => void}>behind a cast</button>
        <button onclick={flag ? () => this.save() : this.other}>a ternary arm</button>
        <button onclick={this.props.onPick ?? (() => this.save())}>a fallback</button>
        <button onclick={function () {}}>a function expression</button>
        <button {...rest} onclick={() => this.save()}>
          after the last spread
        </button>
        <x-thing on:my-event={() => this.save()}>the verbatim spelling</x-thing>
        <Row onPick={() => this.save()} label="a component prop" />
        {list(this.rows, (row) => (
          <button key={row} onclick={() => this.pick(row)}>
            once per row
          </button>
        ))}

        <button onclick={this.save}>a bound method</button>
        <button onclick={this.fieldArrow}>a field holding an arrow</button>
        <button onclick={this.handlers.save}>a property read</button>
        <button onclick={this.pickRow("a")}>a memoized call</button>
        <button onclick={debounce(this.save, 200)}>a call that wraps</button>
        <button onclick={STABLE}>a module const</button>
        <button onclick={arrowHandler}>a module const in another file</button>
        <button onclick={makeHandler()}>a call that builds one</button>
        <button onclick={heldHandler()}>a call that hands back a held one</button>
        <button onclick={loopHandler()}>mutual recursion</button>
        <button onclick={flag ? this.save : this.other}>both arms are methods</button>
        <button onclick={this.props.onPick}>a prop read</button>
        <button onclick={() => this.save()} {...rest}>
          before a spread
        </button>
        <Row onPick={() => this.save()} {...rest} label="a component prop before a spread" />
        <Row ref={() => {}} key={() => {}} onPick={this.save} label="key and ref" />
        <Settled onPick={() => this.save()} label="declared a value" />
        <SettledBase onPick={() => this.save()} label="declared on the base" />
      </div>
    );
  }
}

bootstrap(<Panel />, null);
