import { Component, created, destroyed, mounted, watchProp } from "@ramonda/core";

export interface Card {
  id: number;
  label: string;
}

export interface ExitCardProps {
  card: Card;
  leaving: boolean;
  /** Every one of these is a bound method on the page — a function through props has to be stable. */
  onRemove: () => void;
  onRemoveAfterClass: () => void;
  onRemoveInTransition: () => void;
  onRemoveWithUpdated: () => void;
  say: (line: string) => void;
}

/**
 * One card, as a component, so its lifecycle is visible rather than inferred.
 *
 * The page could draw the row itself — it did at first. Making it a component is what puts `@created`,
 * `@mounted`, `@updated` and `@destroyed` on the log, and those are the four moments the exit question is
 * actually about:
 *
 * - `@watchProp` fires when `leaving` flips, and the row is the SAME element — that is what lets a CSS
 *   transition run at all.
 * - `@destroyed` is the moment the node leaves. Watch WHEN it lands: three seconds after the class for the
 *   timer version, immediately for the plain one, and inside the browser's callback for the view
 *   transition — where the snapshot is already taken, so the animation does not need the node.
 */
export class ExitCard extends Component<ExitCardProps> {
  @created born() {
    this.props.say(`@created   ${this.props.card.label}`);
  }

  @mounted up() {
    this.props.say(`@mounted   ${this.props.card.label}`);
  }

  /**
   * Fires on the class flip, and proves the element was patched rather than replaced.
   *
   * `@watchProp` rather than `@updated`: `@updated` runs on every card on every render, which buried the
   * one line that matters under four that do not. This speaks only for the card whose `leaving` moved.
   */
  @watchProp((props: ExitCardProps) => props.leaving)
  flipped([leaving]: [boolean]) {
    this.props.say(`@watchProp ${this.props.card.label} leaving=${leaving}`);
  }

  @destroyed gone() {
    this.props.say(`@destroyed ${this.props.card.label}`);
  }

  render() {
    return (
      <li className={this.props.leaving ? "exit-card leaving" : "exit-card"}>
        <strong>{this.props.card.label}</strong>
        <span className="exit-actions">
          <button type="button" onclick={this.props.onRemove}>
            remove
          </button>
          <button type="button" onclick={this.props.onRemoveAfterClass}>
            class, then remove
          </button>
          <button type="button" onclick={this.props.onRemoveInTransition}>
            vt + microtasks
          </button>
          <button type="button" onclick={this.props.onRemoveWithUpdated}>
            vt + @updated
          </button>
        </span>
      </li>
    );
  }
}
