import { Component, Host, bootstrap } from "../framework";

declare const rest: Record<string, unknown>;
declare const title: string;
declare const depth: number;

/**
 * Every shape the four element rules have an opinion about, and every shape they must NOT.
 *
 * Written as one component because the rules read markup rather than classes: what encloses a tag
 * is not part of any question here, and one component keeps the fixture readable as a list of
 * cases rather than a directory of them.
 */
@Host("div")
class Gallery extends Component {
  render() {
    return (
      <div>
        {/* REPORTED — nothing announces it. */}
        <img src="/chart.png" />
        {/* Not reported: `alt=""` is the documented way to say "decoration, skip me". */}
        <img src="/divider.png" alt="" />
        {/* Not reported: it has a description. */}
        <img src="/chart.png" alt="Revenue, rising through Q3" />
        {/* Not reported: the same description written in braces. */}
        <img src="/chart.png" alt={"Revenue, rising through Q3"} />
        {/* Not reported: another attribute names it. */}
        <img src="/chart.png" aria-label="Revenue" />
        {/* Not reported: a spread may carry `alt` and nothing here can prove it does not. */}
        <img src="/chart.png" {...rest} />

        {/* REPORTED — an image button with no description. */}
        <input type="image" src="/go.png" />
        {/* Not reported: not an image at all. */}
        <input type="text" />
        {/* REPORTED — an empty `object` has no fallback to announce it by. */}
        <object data="/thing.svg" />
        {/* Not reported: an `object` names itself with its fallback content. */}
        <object data="/thing.svg">A diagram of the venue</object>
        {/* REPORTED — an image map region. */}
        <area shape="rect" />

        {/* REPORTED — a heading with no name. */}
        <h2 />
        {/* Not reported: it has text. */}
        <h2>Pricing</h2>
        {/* Not reported: `aria-label` names it. */}
        <h3 aria-label="Pricing" />
        {/* Not reported: this MIGHT have text and nothing here can prove otherwise. */}
        <h4>{title}</h4>

        {/* REPORTED — a link with no name. */}
        <a href="/pricing" />
        {/* Not reported. */}
        <a href="/pricing">Pricing</a>

        {/* REPORTED — a frame with no name. */}
        <iframe src="/map" />
        {/* Not reported. */}
        <iframe src="/map" title="Map of the venue" />

        {/* REPORTED — jumps ahead of the whole document. */}
        <div tabIndex={1} />
        {/* Not reported: in the tab order where it sits. */}
        <div tabIndex={0} />
        {/* Not reported: out of the tab order, focusable from script. */}
        <div tabIndex={-1} />
        {/* Not reported: this cannot be read, so nothing is claimed about it. */}
        <div tabIndex={depth} />
      </div>
    );
  }
}

bootstrap(<Gallery />, null);

/**
 * Shapes the element rules may or may not recognise, planted to find out which.
 *
 * Nothing here is exotic: a bare JSX boolean, an icon-only link, an index key on a component row.
 */
@Host("div")
class Shapes extends Component {
  render() {
    return (
      <div>
        {/* A bare JSX attribute IS `true`, and a `{true}` says the same thing. */}
        <button type="button" aria-hidden>
          hidden
        </button>
        <button type="button" aria-hidden={true}>
          hidden
        </button>
        {/* Must stay silent: false is not a claim. */}
        <div aria-hidden="false" tabIndex={0}>
          shown
        </div>

        {/* A link whose only child is removed from the accessibility tree. */}
        <a href="/star">
          <span aria-hidden="true">★</span>
        </a>
        {/* Must stay silent: the icon is beside real text. */}
        <a href="/home">
          <span aria-hidden="true">★</span>Home
        </a>
        {/* Must stay silent: a component child is not readable from here. */}
        <a href="/panel">
          <Icon />
        </a>

        {/* A row keyed by its index, on a COMPONENT rather than a tag. */}
        <ul>
          {[1, 2].map((n, i) => (
            <Icon key={i} />
          ))}
        </ul>
      </div>
    );
  }
}

class Icon extends Component {
  render() {
    return <span>icon</span>;
  }
}

bootstrap(<Shapes />, null);
