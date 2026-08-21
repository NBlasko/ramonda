import { Component, Host, bootstrap, destroyed, state, watchProp } from "@ramonda/core";

import { makeBag, makeRows, stamp } from "./make";

const EMPTY: string[] = [];

declare const flag: boolean;

/**
 * `state-mutated-in-place` reads what a field HOLDS to decide whether the runtime guard wraps it.
 * The guard wraps a plain array whatever produced it, so the same array a name away is the same
 * fault.
 */
@Host("div")
class Rows extends Component {
  @state written: string[] = [];
  @state fromHelper = makeRows();
  @state shared = EMPTY;
  @state branched = flag ? [] : [];
  @state bag = makeBag();

  add(row: string) {
    this.written.push(row);
    this.fromHelper.push(row);
    this.shared.push(row);
    this.branched.push(row);
    this.bag.name = row;
  }

  render() {
    return <div>{this.written.length}</div>;
  }
}

/** `interval-with-no-cleanup` — the id reaches the property through a local. */
@Host("div")
class Ticker extends Component {
  tick = 0;
  other = 0;

  start() {
    this.tick = setInterval(() => {}, 1000);
    const id = setInterval(() => {}, 1000);
    this.other = id;
  }

  @destroyed
  stop() {
    clearInterval(this.tick);
    clearInterval(this.other);
  }

  render() {
    return <div>tick</div>;
  }
}

/** `clock-read-while-rendering` — the read is behind a helper in another file. */
@Host("div")
class Clock extends Component {
  render() {
    return (
      <div>
        {Date.now()}
        {stamp()}
        {new Date("2020-01-01").toString()}
      </div>
    );
  }
}

interface Props {
  userId: string;
}

const SELECT_MISSING = (p: Props) => p.nope;

/** `watch-of-a-prop-that-is-not-there` — the selector written here, and a name away. */
@Host("div")
class Watcher extends Component<Props> {
  @watchProp((p: Props) => p.userId)
  onUser() {}

  @watchProp((p: Props) => p.missing)
  onMissing() {}

  @watchProp(SELECT_MISSING)
  onNamed() {}

  render() {
    return <div>{this.props.userId}</div>;
  }
}

bootstrap(<Rows />, null);
bootstrap(<Ticker />, null);
bootstrap(<Clock />, null);
bootstrap(<Watcher userId="a" />, null);
