import { Component, state } from "../framework";

/**
 * A shared base class, which is where the reach used to stop without a word.
 *
 * `this.helper()` was looked for in the class's OWN members and nowhere else, so an inherited
 * method was never found and the walk ended there. And `stateFieldsOf` read only the class's own
 * fields, so state declared up here was not state as far as the rule was concerned.
 *
 * Both were gaps rather than decisions: a base is another CLASS but the same OBJECT, so `this`
 * still means the component and inherited state is the component's state.
 */
export class Panel extends Component {
  /** Declared on the base, written by the base, reached from the subclass's render. */
  @state hits = 0;

  protected count() {
    this.hits = this.hits + 1;
  }

  render() {
    return <div />;
  }
}
