import { Component, Host, bootstrap, persist, state } from "../framework";

declare class Maps<K, V> {
  get(key: K): V;
}
declare class Dates {
  getTime(): number;
}

/**
 * A project that renders in the browser only — the same state, and no blob for it to cross.
 *
 * Nothing here imports a server entry, so the rule is not part of the run at all. Reporting a `Map`
 * in state here would be reporting a working application.
 */
@Host("div")
class Cart extends Component {
  /* Silent: correct with no blob to cross. */
  @state byId = new Maps<string, number>();
  /* Silent for the same reason. */
  @state meta = { openedAt: new Dates() };

  /* Not reported: JSON carries these. */
  @state total = 0;
  @state rows = [];
  @state label = "cart";

  /* Not reported: `@persist` beside it means `persist-of-a-lossy-value` answers, without a gate. */
  @state @persist both = new Dates();

  render() {
    return <div>{this.label}</div>;
  }
}

bootstrap(<Cart />, null);
