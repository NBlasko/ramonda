import { bootstrap, Component } from "@ramonda/core";

/** Two ids the same, both written in the markup with nothing conditional above them. */
export class TwoOfOneId extends Component {
  render() {
    return (
      <form>
        <label htmlFor="email">Email</label>
        <input id="email" />
        <input id="email" />
      </form>
    );
  }
}

/** The same id on two different tags, which is the same fault and easier to miss. */
export class SameIdDifferentTags extends Component {
  render() {
    return (
      <section>
        <h2 id="summary">Summary</h2>
        <p id="summary">Something.</p>
      </section>
    );
  }
}

/** `h1` then `h3` — the outline claims an `h2` section that is not there. */
export class SkipsOneLevel extends Component {
  render() {
    return (
      <article>
        <h1>Title</h1>
        <h3>A subsection of nothing</h3>
      </article>
    );
  }
}

/** Two levels at once, which the report has to word differently. */
export class SkipsTwoLevels extends Component {
  render() {
    return (
      <article>
        <h2>Title</h2>
        <h5>Deep</h5>
      </article>
    );
  }
}

/** Markup written in a plain helper is markup all the same. */
export function panel() {
  return (
    <div>
      <h1>Panel</h1>
      <h4>Detail</h4>
    </div>
  );
}

// ── everything below is CORRECT and must stay silent ─────────────────────────────────────────

/** Different ids, and a heading order that descends one step at a time. */
export class Ordinary extends Component {
  render() {
    return (
      <article>
        <h1>Title</h1>
        <h2 id="one">One</h2>
        <h3>Under one</h3>
        <h2 id="two">Two</h2>
        <h3>Under two</h3>
      </article>
    );
  }
}

/**
 * Going back UP is the end of a section, not a skip. `h3` to `h2` is what an outline does, and a
 * rule that reported it would be reporting every well-structured page there is.
 */
export class ClimbsBack extends Component {
  render() {
    return (
      <article>
        <h1>Title</h1>
        <h2>One</h2>
        <h3>Deep</h3>
        <h2>Two</h2>
      </article>
    );
  }
}

/** Two ids in two branches of a ternary are one id in the document. */
export class OneOrTheOther extends Component {
  editing = false;
  render() {
    return <div>{this.editing ? <input id="name" /> : <span id="name">A name</span>}</div>;
  }
}

/** A guard is the same story from the other side: it may not be there at all. */
export class BehindAGuard extends Component {
  visible = false;
  render() {
    return (
      <div>
        <input id="q" />
        {this.visible && <input id="q" />}
      </div>
    );
  }
}

/** A row is repeated or absent, and either way it is not one element written in place. */
export class InsideAList extends Component {
  rows = ["a", "b"];
  render() {
    return (
      <ul>
        {this.rows.map((row) => (
          <li id="row">{row}</li>
        ))}
      </ul>
    );
  }
}

/** A heading behind a condition may not be there, so the one after it may be no skip at all. */
export class ConditionalHeading extends Component {
  detailed = false;
  render() {
    return (
      <article>
        <h1>Title</h1>
        {this.detailed && <h2>Detail</h2>}
        <h3>Third</h3>
      </article>
    );
  }
}

/** A spread may carry the very `id` this is about. */
export class SpreadingId extends Component {
  rest = { id: "email" };
  render() {
    return (
      <form>
        <input id="email" />
        <input {...this.rest} />
      </form>
    );
  }
}

/** A computed id cannot be compared with anything. */
export class ComputedId extends Component {
  which = "email";
  render() {
    return (
      <form>
        <input id={this.which} />
        <input id={this.which} />
      </form>
    );
  }
}

/** Two renders are two documents' worth of markup as far as this can tell — never compared. */
export class FirstRender extends Component {
  render() {
    return <div id="panel">One</div>;
  }
}

export class SecondRender extends Component {
  render() {
    return <div id="panel">Two</div>;
  }
}

const DEEP = 6;

export /**
 * A heading is what the accessibility tree calls one, which is not always what the tag says.
 *
 * `role-missing-required-aria` already asks a `role="heading"` for its `aria-level`, so a rule that
 * read levels off tags alone would disagree with it about the same element.
 */
@Host("section")
class HeadingsByRole extends Component {
  render() {
    return (
      <section>
        <h1>Title</h1>
        {/* REPORTED — a heading at 3 after a heading at 1, written as a role. */}
        <div role="heading" aria-level={3}>
          A subsection of nothing
        </div>
        {/* REPORTED — the same level, declared elsewhere. Planted because the tree family built
            its contexts with no `resolve` at all, so it read the literal and nothing else. */}
        <div role="heading" aria-level={DEEP}>
          And another
        </div>
      </section>
    );
  }
}

/** An `aria-level` wins over the tag, because the accessibility tree takes it. */
@Host("section")
class LevelOverridesTheTag extends Component {
  render() {
    return (
      <section>
        <h1>Title</h1>
        {/* REPORTED — the tag says 2 and the tree says 4. */}
        <h2 aria-level={4}>Deeper than it looks</h2>
      </section>
    );
  }
}

/** A written role wins over the tag as well, so this is not a heading at all. */
@Host("section")
class NotAHeadingAnyMore extends Component {
  render() {
    return (
      <section>
        <h1>Title</h1>
        {/* Not reported: `presentation` takes it out of the outline, so nothing follows an h1. */}
        <h2 role="presentation">Just big text</h2>
        <h2>A real one</h2>
      </section>
    );
  }
}

/**
 * An `id` on a COMPONENT, twice. Planted to find out whether it is read as a DOM id.
 *
 * `idTable` already decided that an unreadable `id` on a component does NOT silence the family,
 * because a component's `id` is frequently a data prop — `<ProfileCard id={user.id} />` — rather
 * than an element's id. The same question arrives here.
 */
@Host("div")
class TwoComponentIds extends Component {
  render() {
    return (
      <div>
        <Panel id="a" />
        <Panel id="a" />
      </div>
    );
  }
}

class Panel extends Component {
  render() {
    return <span>panel</span>;
  }
}

class App extends Component {
  render() {
    return (
      <main>
        <TwoOfOneId />
        <SameIdDifferentTags />
        <SkipsOneLevel />
        <SkipsTwoLevels />
        <Ordinary />
        <ClimbsBack />
        <OneOrTheOther />
        <BehindAGuard />
        <InsideAList />
        <ConditionalHeading />
        <SpreadingId />
        <ComputedId />
        <FirstRender />
        <SecondRender />
        <HeadingsByRole />
        <LevelOverridesTheTag />
        <NotAHeadingAnyMore />
        <TwoComponentIds />
      </main>
    );
  }
}

bootstrap(<App />, null);
