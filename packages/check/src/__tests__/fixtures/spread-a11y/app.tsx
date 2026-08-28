import { Component, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;

/**
 * What a spread can and cannot take away.
 *
 * The family's spread guard is about an attribute a rule cannot SEE: `<img {...rest} />` may carry
 * the `alt` that would answer `unnamed-image`, and nothing here can say whether it does. That
 * argument does not transfer to an attribute plainly written down — a spread can overwrite a
 * VALUE, and cannot un-write a NAME.
 *
 * So the order matters for one of these three and for neither of the others, and both orders are
 * written for each.
 */
class Spreading extends Component {
  render() {
    return (
      <div>
        {/* ✗ A misspelled NAME. No spread on either side can un-spell it. */}
        <div {...rest} aria-lablled="Filters" />
        <div aria-lablled="Filters" {...rest} />

        {/* ✗ A `role` a spread cannot reach over: the later attribute wins. */}
        <div {...rest} role="buton" />
        {/* ✓ The same role with the spread AFTER it — `rest` may replace it, so nothing is proved. */}
        <div role="buton" {...rest} />

        {/* ✗ An accessibility attribute on a tag that has no node to describe. The tag is the
            subject, and a spread cannot change the tag. */}
        <meta {...rest} aria-hidden="true" />
        <meta aria-hidden="true" {...rest} />

        {/* The same three with no spread at all, as the control. */}
        <div aria-lablled="Filters" />
        <div role="buton" />
        <meta aria-hidden="true" />

        {/* ✓ The silence the guard exists for: the `alt` may be in `rest`. */}
        <img {...rest} />
      </div>
    );
  }
}

bootstrap(<Spreading />, null);
