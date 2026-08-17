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
