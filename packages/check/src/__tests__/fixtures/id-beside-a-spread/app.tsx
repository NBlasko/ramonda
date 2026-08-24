import { Component, Host, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;

/**
 * An id written out on an element that also SPREADS.
 *
 * Every rule in this family reports an ABSENCE — "nothing in this project carries this id" — so an
 * id dropped from the table is a report against correct markup. The table used to skip a spreading
 * element entirely, including the `id` spelled out on the very same tag.
 *
 * Both orders are kept, and that is the opposite asymmetry to the element family's. There,
 * widening what is reported can only ADD false reports. Here, widening the set of known ids can
 * only PREVENT one.
 */
@Host("div")
class App extends Component {
  render() {
    return (
      <div>
        <h2 {...rest} id="pricing">
          Pricing
        </h2>
        <h2 id="terms" {...rest}>
          Terms
        </h2>

        {/* ✓ ✓ Both destinations are written down, one line above. */}
        <a href="#pricing">Pricing</a>
        <a href="#terms">Terms</a>

        {/* ✗ This one really does go nowhere, and is what says the rule is still on. */}
        <a href="#nowhere-at-all">Nowhere</a>

        {/* ✓ A label whose control carries the id past a spread. */}
        <label htmlFor="email">Email</label>
        <input {...rest} id="email" type="text" />

        {/* ✗ And one whose control does not exist at all. */}
        <label htmlFor="missing">Missing</label>

        {/*
          ✓ A spreading element is still not asked about its own REFERENCES: this `href` may be
          replaced by whatever `rest` carries, so nothing is claimed about where it goes.
        */}
        <a {...rest} href="#also-nowhere">
          Not asked
        </a>
      </div>
    );
  }
}

bootstrap(<App />, null);
