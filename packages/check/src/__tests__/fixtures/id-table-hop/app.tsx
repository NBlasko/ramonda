import { Component, Host, bootstrap } from "@ramonda/core";

import { EMAIL_ID, OVERVIEW_ID, SUMMARY_ID } from "./ids";

/**
 * A project that keeps its ids in one module, which is the ordinary way to make two references
 * agree — and which used to switch this whole family off.
 *
 * Reading only the literal made every `id={NAME}` an UNREADABLE id, and one unreadable id anywhere
 * silences `reference-to-an-id-that-is-not-there` for the entire project. The two faults at the
 * bottom of this render were reported by nothing.
 */
@Host("div")
class Page extends Component {
  render() {
    return (
      <div>
        {/* Every one of these pairs UP. Nothing here is a fault. */}
        <h2 id={SUMMARY_ID}>Summary</h2>
        <section aria-labelledby="summary">a</section>

        <label htmlFor={EMAIL_ID}>Email</label>
        <input id={EMAIL_ID} type="text" />

        <a href="#summary">to the summary</a>

        {/* A REAL fault, in the same project: the typo resolves to nothing. */}
        <section aria-labelledby="sumary">b</section>
        <a href="#sumary">nowhere</a>

        {/* Pairs up with the `@Host` id below, which is also a name away. */}
        <a href="#overview">to the overview</a>
        <a href="#filters">to the filters</a>
      </div>
    );
  }
}

/** An id written in `@Host` props, which is on the page and is in no JSX element. */
@Host("section", () => ({ id: OVERVIEW_ID }))
class Overview extends Component {
  render() {
    return <section>overview</section>;
  }
}

/** The SHORTHAND spelling of the same claim, which was read by nothing at all. */
const id = "filters";

@Host("aside", () => ({ id }))
class Filters extends Component {
  render() {
    return <aside>filters</aside>;
  }
}

bootstrap(<Page />, null);
bootstrap(<Overview />, null);
bootstrap(<Filters />, null);
