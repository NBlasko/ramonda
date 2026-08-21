import { Component, Host, bootstrap } from "@ramonda/core";

import { CHECKBOX, CURRENT, IMAGE_TYPE, PRESENTATION } from "./names";

const LOUD = "loud";
const KEY = "s";
const YES = true;
const TABBABLE = 0;
const DUP = "dup";

/**
 * The eight rules that read an element through `attr`, `stringAttr`, `trueAttr` and `numberAttr`,
 * each written the way it is documented and then ONE HOP away — a local `const`, a module `const`,
 * an imported one.
 *
 * `fixtures/one-hop` asked this of `attr` and `numberAttr` and closed them. Every reader beside
 * them was still literal-only, which is not visible from any rule's own source: each of these
 * rules calls a helper whose name says it reads the attribute.
 */
@Host("div")
class Probe extends Component {
  render() {
    /** A2 — a local one line up, inside the function that writes the element. */
    const localLive = "loud";

    return (
      <div>
        {/* aria-value */}
        <div aria-live="loud" />
        <div aria-live={LOUD} />
        <div aria-current={CURRENT} />
        <div aria-live={localLive} />

        {/* unnamed-image */}
        <img src="a.png" />
        <input type="image" />
        <input type={IMAGE_TYPE} />

        {/* role-takes-no-name */}
        <div aria-label="Filters" />
        <span role="presentation" aria-label="Filters" />
        <span role={PRESENTATION} aria-label="Filters" />

        {/* access-key */}
        <button accessKey="a">a</button>
        <button accessKey={KEY}>b</button>

        {/* aria-hidden-on-focusable */}
        <button aria-hidden="true">c</button>
        <button aria-hidden={YES}>d</button>
        <div aria-hidden="true" tabIndex={TABBABLE}>
          e
        </div>

        {/* role-missing-required-aria */}
        <div role="checkbox" />
        <div role={CHECKBOX} />

        {/* duplicate-id */}
        <p id="dup" />
        <p id={DUP} />

        {/* empty-heading-or-link — a heading whose only child is hidden */}
        <h4>
          <span aria-hidden="true" />
        </h4>
        <h4>
          <span aria-hidden={YES} />
        </h4>
      </div>
    );
  }
}

const HEADING = "heading";
const SIX = 6;
const SIX_AS_TEXT = "6";

/** One render per heading chain, because a chain reads every heading in it. */
@Host("section")
class WrittenLevels extends Component {
  render() {
    return (
      <section>
        <h1>one</h1>
        <div role="heading" aria-level={6} />
      </section>
    );
  }
}

@Host("section")
class LevelsOneHopAway extends Component {
  render() {
    return (
      <section>
        <h1>one</h1>
        <div role={HEADING} aria-level={SIX} />
      </section>
    );
  }
}

/** `aria-level="6"` is read as a number where it is written; the same string a name away is not. */
@Host("section")
class LevelWrittenAsText extends Component {
  render() {
    return (
      <section>
        <h1>one</h1>
        <div role="heading" aria-level={SIX_AS_TEXT} />
      </section>
    );
  }
}

/**
 * A written `role` takes the element OUT of the outline, and this one is a name away.
 *
 * Nothing here is a fault: at runtime the `<h3>` is `presentation` and is not a heading, so no
 * level is skipped. A report on this markup is a report on correct markup.
 */
@Host("section")
class NotAHeadingAtRuntime extends Component {
  render() {
    return (
      <section>
        <h1>one</h1>
        <h3 role={PRESENTATION}>a decoration</h3>
      </section>
    );
  }
}

bootstrap(<Probe />, null);
bootstrap(<WrittenLevels />, null);
bootstrap(<LevelsOneHopAway />, null);
bootstrap(<LevelWrittenAsText />, null);
bootstrap(<NotAHeadingAtRuntime />, null);
