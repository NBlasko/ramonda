/**
 * Which component's `render()` is currently building vnodes.
 *
 * Not a debug facility — this ships in production. The diff uses it to refuse a
 * match between a node a component built itself and a node that was handed to it
 * from outside, which is what keeps a component's own chrome from being claimed
 * as someone else's content:
 *
 *   <ul>
 *     <Chip label="HEAD" />     built by Panel
 *     {this.props.slots.body}   built by whoever called Panel
 *     <Chip label="FOOT" />     built by Panel
 *   </ul>
 *
 * Keying off WHO BUILT a vnode rather than how it arrived is what makes this
 * work for any prop name, at any nesting depth — there is no way to know which
 * props carry JSX, so the arrival path cannot be the signal.
 *
 * A single slot is enough: renders never nest. `render()` returns a vnode tree
 * and its children are rendered later, from the diff.
 *
 * 0 means "built outside any render": a module-level `const foo = <div/>`, a
 * field initializer, a route table. That is a GROUP, not a wildcard — such a
 * vnode matches only other vnodes built outside a render, never a component's
 * own output. A wildcard would leave exactly the elements a developer hoists to
 * module scope as the ones with no protection.
 */
export const currentOrigin: { id: number } = { id: 0 };
