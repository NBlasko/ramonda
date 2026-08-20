import { Component, Host, bootstrap, list } from "../framework";

declare const rows: { id: string; name: string }[];
declare const profileId: string;

/**
 * A component whose `id` prop is DATA — a profile's id, not a document id.
 *
 * Here because the first version of the table treated it as an id it could not read and silenced
 * both rules across the whole project. Found by running against `apps/docs`, where
 * `<ProfileCard id={this.id} />` hands its id to `getProfile()` and never touches the DOM.
 */
/** A component whose HOST carries the id — written in `@Host` props, not in any JSX element. */
@Host("section", () => ({ id: "host-anchor" }))
class Anchored extends Component {
  render() {
    return <p>anchored</p>;
  }
}

/** The same, with a props callback that has a BLOCK body rather than a concise one. */
@Host("section", () => {
  return { id: "block-anchor" };
})
class BlockAnchored extends Component {
  render() {
    return <p>anchored from a block</p>;
  }
}

@Host("article")
class ProfileCard extends Component<{ id: string }> {
  render() {
    return <article>{this.props.id}</article>;
  }
}

/** Where the ids live. */
@Host("main")
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

        {/* Not reported: the id is written in `@Host` props rather than in any JSX element, and it
            is on the page all the same. This used to be reported as a link to nowhere. */}
        <Anchored />
        <a href="#host-anchor">to the anchored section</a>
        {/* Not reported either: the same id, written in a props callback with a BLOCK body. */}
        <BlockAnchored />
        <a href="#block-anchor">to the one written in a block</a>
      </main>
    );
  }
}

bootstrap(<Page />, null);
