import { Component } from "../base/Component";

/**
 * The shapes the JSX types must REFUSE, each pinned by `@ts-expect-error`.
 *
 * A directive that stops being necessary is itself an error — "unused '@ts-expect-error' directive"
 * — so this file fails the typecheck the day any of these starts compiling. That is the whole point
 * of writing them down: a requirement nobody can accidentally relax.
 *
 * Not a test file: there is nothing to run. It is a claim about the types, checked by `tsc` in the
 * package's own `check-types` run.
 */
declare const rest: Record<string, unknown>;

export class Refused extends Component {
  render() {
    return (
      <div>
        {/* @ts-expect-error — nothing names it */}
        <img src="/a.png" />
        {/* @ts-expect-error — a frame with no title and no ARIA name */}
        <iframe src="/x" />
        {/* @ts-expect-error — an area is a link with a picture's problem */}
        <area href="/x" />
        {/* @ts-expect-error — an untyped bag says nothing about carrying a name */}
        <img {...rest} />
      </div>
    );
  }
}
