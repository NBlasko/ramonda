import { Component, bootstrap } from "@ramonda/core";

/**
 * The links, in one file — and the ids they point at in ANOTHER, which is the whole reason this
 * family exists. No per-render subject can see both ends of this pair.
 */
export class Nav extends Component {
  render() {
    return (
    <nav>{(
      <nav>
        {/* Not reported: `pricing` is an id in page.tsx. */}
        <a href="#pricing">Pricing</a>
        {/* Not reported: the skip link's target is there too. */}
        <a href="#content">Skip to content</a>
        {/* REPORTED — nothing in the project carries `pricng`. */}
        <a href="#pricng">Pricing (typo)</a>
        {/* Not reported: a real destination rather than a fragment. */}
        <a href="/about">About</a>
      </nav>
    );}</nav>
  )}
}

bootstrap(<Nav />, null);