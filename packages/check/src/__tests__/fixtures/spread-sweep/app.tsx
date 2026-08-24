import { Component, Host, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;

/**
 * The rest of the element family, beside a spread, in both orders.
 *
 * `spread-a11y` settled the principle on three rules; this is every other rule that turned out to
 * be silenced by a spread it had no reason to fear. The line each of them falls on is not
 * name-versus-value — a later spread carrying `undefined` really does remove an attribute,
 * measured through `renderToString` — it is what the rule is ABOUT:
 *
 * - what the author WROTE stands whichever side the spread is on;
 * - what the element WILL BE is only provable when no spread comes after the attribute.
 */
@Host("div")
class Sweep extends Component {
  render() {
    return (
      <div>
        {/* ✗✗✗ `class` is the HTML name and `className` was meant. Written is written. */}
        <div {...rest} class="card" />
        <div class="card" {...rest} />
        <div class="card" />

        {/* ✗ ✓ ✗ A tabIndex a spread cannot reach over, one it can, and the control. */}
        <div {...rest} tabIndex={5} />
        <div tabIndex={5} {...rest} />
        <div tabIndex={5} />

        {/* ✗✗ Neither the tag nor what encloses it is an attribute. */}
        <li {...rest}>item</li>
        <li>item</li>

        {/* ✗ ✓ ✗ An `aria-valuenow` that is not a number. */}
        <div {...rest} role="progressbar" aria-valuenow="lots" />
        <div role="progressbar" aria-valuenow="lots" {...rest} />
        <div role="progressbar" aria-valuenow="lots" />

        {/* ✗ ✓ ✗ An access key this element takes off the user. */}
        <div {...rest} accessKey="s" />
        <div accessKey="s" {...rest} />
        <div accessKey="s" />

        {/* ✗ ✓ ✗ Hidden from assistive technology and still in the tab order. */}
        <div {...rest} aria-hidden="true" tabIndex={0} />
        <div aria-hidden="true" tabIndex={0} {...rest} />
        <div aria-hidden="true" tabIndex={0} />

        {/* ✗ ✓ ✗ A role that takes no name, given one. */}
        <div {...rest} role="presentation" aria-label="x" />
        <div role="presentation" aria-label="x" {...rest} />
        <div role="presentation" aria-label="x" />

        {/* ✓ The silence the family guard exists for: the `alt` may be in `rest`. */}
        <img {...rest} />
      </div>
    );
  }
}

bootstrap(<Sweep />, null);
