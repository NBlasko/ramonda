import { Component, Host, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;

/**
 * A misspelled `aria-` NAME beside a spread.
 *
 * The family's spread guard is about an attribute a rule cannot see: `<img {...rest} />` may carry
 * the `alt` that would answer `unnamed-image`. It does not transfer to a name that is plainly
 * written — a spread can overwrite an attribute's VALUE, and cannot un-write its name.
 */
@Host("div")
class Spreading extends Component {
  render() {
    return (
      <div>
        {/* ✗ Misspelled, and a spread cannot un-spell it. */}
        <div {...rest} aria-lablled="Filters" />
        {/* ✗ An `aria-` on a tag that takes none. */}
        <br {...rest} aria-label="nothing" />
        {/* ✗ A role that does not exist. */}
        <div {...rest} role="buton" />

        {/* The same three with no spread, as the control. */}
        <div aria-lablled="Filters" />
        <br aria-label="nothing" />
        <div role="buton" />
      </div>
    );
  }
}

bootstrap(<Spreading />, null);
