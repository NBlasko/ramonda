import { Component, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;
declare const kind: string;
declare const label: string;

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ A landmark declared and not named — the browser gives back a generic box. */}
        <div role="region">filters</div>

        {/* ✗ The same, with a name that is written and EMPTY. */}
        <div role="region" aria-label="">
          filters
        </div>

        {/* ✓ Named outright. */}
        <div role="region" aria-label="Filters">
          filters
        </div>
        {/* ✓ Named by pointing at something. */}
        <h2 id="filters-heading">Filters</h2>
        <div role="region" aria-labelledby="filters-heading">
          filters
        </div>
        {/* ✓ A name this cannot READ is somebody naming it. */}
        <div role="region" aria-label={label}>
          filters
        </div>

        {/* ✓ A `<section>` with no name is GENERIC by design, not a failed landmark. */}
        <section>filters</section>

        {/* ✓ A spread may be carrying the name. */}
        <div role="region" {...rest}>
          filters
        </div>
        {/* ✓ A role this cannot read may not be a region at all. */}
        <div role={kind}>filters</div>
        {/* ✓ A chain is a list of alternatives, and which one wins is not asked here. */}
        <div role="region form">filters</div>
      </div>
    );
  }
}

bootstrap(<App />, null);
