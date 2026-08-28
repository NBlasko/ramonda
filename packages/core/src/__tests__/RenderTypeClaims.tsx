import { Component } from "../base/Component";
import type { RamondaNode } from "../types/vdom";

/**
 * What `render()` is allowed to return, pinned as code.
 *
 * Not a test file — there is nothing to run. These are claims checked by this package's own
 * `check-types`, in both directions: a shape with no directive must compile, and a shape under
 * `@ts-expect-error` must NOT — TypeScript reports an unused directive the day one of them starts
 * compiling, so relaxing any of this fails the build rather than passing quietly.
 *
 * The nesting claims are the ones with a story. `RamondaNode` was `RamondaAtom | RamondaAtom[]` —
 * one level — and `props.children` is itself an array, so the plainest way to put a slot inside a
 * range did not compile while the runtime handled it correctly. The type is recursive now, and
 * these say so.
 */

declare const slot: RamondaNode;

/** One node. The commonest render there is. */
class One extends Component {
  render() {
    return <p>one</p>;
  }
}

/** A RANGE — the whole point of a component owning several siblings. */
class Several extends Component {
  render() {
    return [<td>a</td>, <td>b</td>];
  }
}

/** Nothing at all is an ordinary answer, not an error to apologise for. */
class Nothing extends Component {
  render() {
    return null;
  }
}

/** A slot passed straight through. */
class PassThrough extends Component<{ children?: RamondaNode }> {
  render() {
    return this.props.children;
  }
}

/** A slot inside a range — an array holding an array, which is what the widening is for. */
class SlotInARange extends Component<{ children?: RamondaNode }> {
  render() {
    return [<i>chrome</i>, this.props.children];
  }
}

/** And nested further, because a slot may itself hold a slot that holds one. */
class Deeper extends Component {
  render() {
    return [<i>chrome</i>, [slot, [slot]]];
  }
}

/** A conditional hole beside a slot: the shape that keeps a slot's position stable. */
class WithAHole extends Component<{ chrome?: boolean; children?: RamondaNode }> {
  render() {
    return [this.props.chrome ? <i>chrome</i> : null, this.props.children];
  }
}

/**
 * A promise is the one thing render() may never return, and the type says so before RMD060 has to.
 */
class Async extends Component {
  // @ts-expect-error — an async render() returns a promise, not markup.
  async render() {
    return <p>too late</p>;
  }
}

/** A plain object is not a node, at any depth. */
class NotANode extends Component {
  // @ts-expect-error — `{ nope: true }` is not markup.
  render() {
    return { nope: true };
  }
}

/** And not inside an array either — the widening is about ARRAYS, not about what may go in one. */
class NotANodeNested extends Component {
  // @ts-expect-error — still not markup one level down.
  render() {
    return [<i>chrome</i>, [{ nope: true }]];
  }
}

export type { One, Several, Nothing, PassThrough, SlotInARange, Deeper, WithAHole, Async, NotANode, NotANodeNested };
