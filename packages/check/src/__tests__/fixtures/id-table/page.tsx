import { Component, bootstrap, list } from "@ramonda/core";

declare const rows: { id: string; name: string }[];
declare const profileId: string;

/**
 * A component whose `id` prop is DATA — a profile's id, not a document id.
 *
 * Here because the first version of the table treated it as an id it could not read and silenced
 * both rules across the whole project. Found by running against `apps/docs`, where
 * `<ProfileCard id={this.id} />` hands its id to `getProfile()` and never touches the DOM.
 */
/** A component that carries an id on its own outermost element. */
class Anchored extends Component {
  render() {
    return (
      <section id="host-anchor">
        <p>anchored</p>
      </section>
    );
  }
}

/** The same id, written on an element one level in — still an id the project carries. */
class BlockAnchored extends Component {
  render() {
    return (
      <section>
        <p id="block-anchor">anchored from within</p>
      </section>
    );
  }
}

class ProfileCard extends Component<{ id: string }> {
  render() {
    return (
      <article>
        <article>{this.props.id}</article>
      </article>
    );
  }
}

/** Where the ids live. */
export class Page extends Component {
  render() {
    return (
      <main id="content">
        <h2 id="pricing">Pricing</h2>

        {/* Not reported: `pricing` is right there. */}
        <section aria-labelledby="pricing">
          <p id="blurb">What it costs.</p>
          {/* Not reported: a LIST of ids, and both resolve. */}
          <div aria-labelledby="pricing blurb" />
          {/* REPORTED — the second of the two does not exist. */}
          <div aria-labelledby="pricing blrb" />
        </section>

        {/* REPORTED — the label names nothing, so the input has no name and the click does nothing. */}
        <label for="emial">Email</label>
        <input id="email" aria-label="Email" />

        {/* Not reported: corrected, and the id is on the input above. */}
        <label for="email">Email again</label>

        {/* Not reported: a template can only produce ids beginning with `row-`, so this is one it
              could have made. */}
        <a href="#row-3">Third row</a>
        {list(rows, (row) => (
          <li id={`row-${row.id}`}>{row.name}</li>
        ))}

        {/* REPORTED — no template could produce this, and no literal carries it. */}
        <div aria-controls="panel-that-never-was" />

        {/* Not reported, and it must not silence anything either: `id` on a COMPONENT may be data,
              and here it is. If it were forwarded to a host element, that host element would be in
              the source too and would silence the family on its own terms. */}
        <ProfileCard id={profileId} />

        {/* Not reported: both ids are written on real elements inside a component, and a link
              from anywhere in the project resolves against them. */}
        <Anchored />
        <a href="#host-anchor">to the anchored section</a>
        <BlockAnchored />
        <a href="#block-anchor">to the one written further in</a>
      </main>
    );
  }
}

bootstrap(<Page />, null);
