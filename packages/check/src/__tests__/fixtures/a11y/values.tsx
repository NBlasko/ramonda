import { bootstrap, Component } from "@ramonda/core";

/**
 * `aria-*` names that are all spelled correctly, carrying values the specification does not have.
 * Separate from `aria.tsx` because that file is about NAMES: a value fault there would be reported
 * twice and neither test could say which rule had done it.
 */
export class Values extends Component {
  hidden = true;
  render() {
    return (
      <div>
        {/* REPORTED — a boolean takes `true` or `false`, and "yes" is neither. */}
        <span aria-hidden="yes" />
        {/* REPORTED — nor is 1, however plainly it means one thing. */}
        <span aria-atomic="1" />
        {/* REPORTED — `mixed` belongs to a tristate, and `aria-selected` is not one. */}
        <li aria-selected="mixed" />
        {/* REPORTED — a token outside the closed list. */}
        <div aria-live="loud" />
        {/* REPORTED — `aria-current` has a list of its own, and `yes` is not in it. */}
        <a aria-current="yes" href="/x">
          Here
        </a>
        {/* REPORTED — an integer, written as a word. */}
        <div role="heading" aria-level="two" />
        {/* REPORTED — a number, with a stray unit. */}
        <div role="slider" aria-valuenow="40%" />

        {/* Not reported: `false` is a value and says something the absence does not. */}
        <span aria-hidden="false" />
        {/* Not reported: `undefined` is permitted where the spec says so. */}
        <div aria-expanded="undefined" />
        {/* Not reported: a tristate really does take `mixed`. */}
        <div role="checkbox" aria-checked="mixed" />
        {/* Not reported: every one of these is in its list. */}
        <div aria-live="polite" aria-autocomplete="list" aria-sort="ascending" aria-invalid="spelling" />
        {/* Not reported: a negative integer is still an integer, and a decimal is still a number. */}
        <div aria-colindex="-1" aria-valuemin="0.5" aria-valuemax="1e3" />
        {/* Not reported: nothing here can read what the expression holds. */}
        <span aria-hidden={this.hidden} />
        {/* Not reported: a label takes any string, so there is no value table for it. */}
        <span aria-label="Anything at all" aria-labelledby="title" />
        {/* Not reported: a component's prop is not markup yet. */}
        <Panel aria-hidden="yes" />
      </div>
    );
  }
}

export class Panel extends Component {
  render() {
    return <div />;
  }
}

bootstrap(<Values />, null);
