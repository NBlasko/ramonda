import { bootstrap, Component } from "@ramonda/core";

/**
 * Roles that are all real — the vocabulary rule has nothing to say about any of them — written
 * without the states and properties the specification says they cannot work without.
 */
export class Roles extends Component {
  checked = false;
  kind = "checkbox";
  render() {
    return (
      <div>
        {/* REPORTED — a checkbox that cannot say whether it is checked. */}
        <div role="checkbox" />
        {/* REPORTED — the same, through two roles that mean the same thing. */}
        <div role="switch" />
        <div role="menuitemradio" />
        {/* REPORTED — a heading with no place in the outline. */}
        <div role="heading">Section</div>
        {/* REPORTED — a slider at no value. */}
        <div role="slider" />
        {/* REPORTED — twice over, and the report has to name both. */}
        <div role="scrollbar" />
        {/* REPORTED — a combobox that cannot say whether it is open. */}
        <div role="combobox" />

        {/* Not reported: the state is there. */}
        <div role="checkbox" aria-checked="false" />
        {/* Not reported: an expression is written, and whether it holds the right value is the
            other rule's question. */}
        <div role="checkbox" aria-checked={this.checked} />
        {/* Not reported: every required one is present. */}
        <div role="scrollbar" aria-controls="list" aria-valuenow="0" />
        {/* Not reported: a role with nothing required of it. */}
        <div role="button" />
        <div role="note" />
        {/* Not reported: the element's own markup carries the state. */}
        <input type="checkbox" role="checkbox" />
        {/* Not reported: an implicit role is the host language's, and it brings its own level. */}
        <h2>A heading</h2>
        {/* Not reported: a fallback chain is a list of alternatives, not one claim. */}
        <div role="switch checkbox" />
        {/* Not reported: nothing here can read the role. */}
        <div role={this.kind} />
        {/* Not reported: a component's prop is not markup yet. */}
        <Widget role="checkbox" />
      </div>
    );
  }
}

export class Widget extends Component {
  render() {
    return <div />;
  }
}

bootstrap(<Roles />, null);
