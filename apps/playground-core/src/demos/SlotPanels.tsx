import { Component, Host, state, onElement } from "@ramonda/core";
import type { RamondaNode, VNode } from "@ramonda/core";

/**
 * The pieces the slot page composes. Every panel deliberately uses the SAME tag
 * for its own chrome as the caller is likely to pass in — that is the shape
 * where a reorder or a show/hide used to move state across the boundary.
 *
 * Click any chip to bump its counter, then reorder or hide things. The counter
 * is the point: the text always looked right even when reconciliation was
 * wrong, so only per-component state shows whether a node was claimed by the
 * wrong owner.
 */

/** A component chip. Click it to mark it. */
@Host("li")
export class Chip extends Component<{ label: string; tone?: string }> {
  @state hits = 0;
  @onElement("click")
  bump() {
    this.hits++;
  }
  render() {
    return (
      <span className={`chip ${this.props.tone ?? ""}`}>
        {this.props.label}
        <b className="count">{this.hits}</b>
      </span>
    );
  }
}

/**
 * Slot through `children`, which is always an ARRAY — h collects the rest
 * params. The array stays one child of the <ul> instead of being spliced into
 * it, so HEAD and FOOT are not in the same key space as whatever arrives.
 */
@Host("div")
export class ArrayPanel extends Component<{ children?: RamondaNode }> {
  render() {
    return (
      <ul className="slotlist">
        <Chip label="HEAD (panel's own)" tone="chrome" />
        {this.props.children}
        <Chip label="FOOT (panel's own)" tone="chrome" />
      </ul>
    );
  }
}

/**
 * Slot through a NAMED prop, and a single element rather than an array. There
 * is no nested structure to preserve here — what keeps the panel's chrome safe
 * is that every vnode records which component's render() built it.
 */
@Host("div")
export class IconPanel extends Component<{ icon: VNode | null }> {
  render() {
    return (
      <ul className="slotlist">
        <Chip label="HEAD (panel's own)" tone="chrome" />
        {this.props.icon}
        <Chip label="FOOT (panel's own)" tone="chrome" />
      </ul>
    );
  }
}

/**
 * Plain tags, no components anywhere, and the slot arrives nested inside an
 * object. Same guarantees: the arrival path never mattered, only who built it.
 */
@Host("div")
export class PlainPanel extends Component<{ slots: { body: RamondaNode } }> {
  render() {
    return (
      <ul className="slotlist">
        <li className="chip chrome">HEAD (plain li)</li>
        {this.props.slots.body}
        <li className="chip chrome">FOOT (plain li)</li>
      </ul>
    );
  }
}

/**
 * A text slot sitting between real elements. Text has no tag and no key, so it
 * is the case with the least to match on — worth having on the page precisely
 * because it looks like nothing.
 */
@Host("p")
export class TextPanel extends Component<{
  before: RamondaNode;
  children?: RamondaNode;
}> {
  render() {
    return (
      <span className="textrow">
        <b>start·</b>
        {this.props.before}
        <em className="mid">·middle·</em>
        {this.props.children}
        <b>·end</b>
      </span>
    );
  }
}
