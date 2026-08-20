import { Component, bootstrap, watchProp } from "../framework";

/** A key built in a helper — the same fault behind a function call. */
function keyOf(q: string): { q: string } {
  return { q };
}

/** And one that hands back an object it holds, which is a stable reference. */
const HELD = { q: "" };
function heldKey(): { q: string } {
  return HELD;
}

class Child extends Component<{ q: string; page: number; filter: { q: string } }> {
  @watchProp((p) => ({ q: p.q }))
  fresh() {}

  @watchProp((p) => [p.q, p.page])
  freshArray() {}

  @watchProp((p) => p.q)
  plain() {}

  @watchProp(
    (p) => p.q,
    (p) => p.page,
  )
  two() {}

  // REPORTED, and the report says WHICH: only the second one builds.
  @watchProp(
    (p) => p.q,
    (p) => ({ page: p.page }),
  )
  second() {}

  // REPORTED — a helper that builds is the same fault one hop away.
  @watchProp((p) => keyOf(p.q))
  viaHelper() {}

  // Not reported: the helper hands back an object it holds, which is a stable reference.
  @watchProp(() => heldKey())
  viaHeld() {}

  // Not reported: reading an object prop is not building one. If the PARENT rebuilds it,
  // `fresh-object-in-props` reports it at the call site, which is where the fix belongs.
  @watchProp((p) => p.filter)
  reads() {}

  render() {
    return <li>{this.props.q}</li>;
  }
}

bootstrap(<Child q="a" page={1} filter={{ q: "a" }} />, null);
