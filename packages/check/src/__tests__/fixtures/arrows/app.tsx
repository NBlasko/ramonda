import { Component, Hook, bootstrap } from "@ramonda/core";

declare function debounce<T>(fn: T, ms: number): T;
declare function memoize<T>(fn: T): T;

class Panel extends Component {
  // ✗ reads `this` — a method would be bound already.
  onPick = (id: string) => this.select(id);

  // ✗ reads nothing of the instance — belongs outside the class.
  format = (n: number) => n.toFixed(2);

  // ✗ a `function` in a field is the same waste, and does not even get the instance.
  legacy = function (n: number) {
    return n + 1;
  };

  // ✓ a wrapper: it is a function only after the call has run, and has nowhere else to live.
  save = debounce(this.persist, 200);
  cheap = memoize(this.compute);

  // ✓ not a function at all.
  label = "panel";
  rows = [1, 2, 3];

  // ✓ methods, which is the whole point.
  select(id: string) {
    return id;
  }
  persist() {}
  compute() {
    return 1;
  }
  render() {
    return <span>x</span>;
  }
}

class Counter extends Hook {
  // ✗ a hook is a class too.
  tick = () => this.n++;
  n = 0;
}

// ✓ not a Ramonda class, so not this check's business.
class Plain {
  helper = (x: number) => x * 2;
}

class App extends Component {
  render() {
    return <Panel />;
  }
}
bootstrap(<App />, document.body);

class Statics extends Component {
  // ✓ static: one per class, not one per instance — method binding has nothing to do with it.
  private static readonly load = () => import("./nowhere");
  render() {
    return <span>x</span>;
  }
}
