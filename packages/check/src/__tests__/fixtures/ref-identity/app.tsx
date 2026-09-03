import { Component, Hook, compute, createRef, memoized } from "@ramonda/core";
import { createRef as ours } from "./own-ref";

/** ✓ Where a ref belongs: a field, one identity for the component's whole life. */
export class OnAField extends Component {
  private field = createRef<HTMLInputElement>();
  render() {
    return <input ref={this.field} />;
  }
}

/** ✓ The callback form, on a field — how `Select` and `TextArea` learn their element arrived. */
export class OnAFieldWithACallback extends Component {
  private field = createRef<HTMLInputElement>((node) => this.arrived(node));
  arrived(_node: HTMLInputElement | null): void {}
  render() {
    return <input ref={this.field} />;
  }
}

/** ✗ In the render body. */
export class InTheRender extends Component {
  render() {
    const held = createRef<HTMLInputElement>();
    return <input ref={held} />;
  }
}

/** ✗ Written straight into the attribute, which is the same call in the same place. */
export class InTheAttribute extends Component {
  render() {
    return <input ref={createRef<HTMLInputElement>()} />;
  }
}

/** ✗ In a helper the render calls — the walk follows it, and the path says so. */
export class ThroughAHelper extends Component {
  private build() {
    return createRef<HTMLInputElement>();
  }
  render() {
    return <input ref={this.build()} />;
  }
}

/** ✗ In a `@compute`, which caches its answer until something it read changes. */
export class InACompute extends Component {
  @compute get held() {
    return createRef<HTMLInputElement>();
  }
  render() {
    return <input ref={this.held} />;
  }
}

/** ✗ In a `@memoized` member the render calls. */
export class InAMemoized extends Component {
  @memoized pick(_which: string) {
    return createRef<HTMLInputElement>();
  }
  render() {
    return <input ref={this.pick("a")} />;
  }
}

/** ✗ In a hook's props callback, which runs again whenever a signal it read changes. */
export class Store extends Hook<{ held: unknown }> {}
export class InAPropsCallback extends Component {
  store = this.use(Store, () => ({ held: createRef<HTMLInputElement>() }));
  render() {
    return <p>{String(this.store !== undefined)}</p>;
  }
}

/** ✓ An app's own function of the same name, which these semantics have nothing to say about. */
export class SomebodyElsesCreateRef extends Component {
  render() {
    const held = ours<HTMLInputElement>();
    return <input ref={held} />;
  }
}

/** ✓ Not reached from a render: a `@memoized` nobody calls builds nothing. */
export class MemoizedButUncalled extends Component {
  @memoized unused() {
    return createRef<HTMLInputElement>();
  }
  render() {
    return <input />;
  }
}
