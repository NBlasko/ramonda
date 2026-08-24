import { Component, bootstrap, persist, state } from "@ramonda/core";

declare class Maps<K, V> {
  get(key: K): V;
}
declare class Dates {
  getTime(): number;
}

/** Module scope, and a helper — the shapes `lossyIn` follows, so the gate has to cover them too. */
const SHARED = new Maps<string, number>();

function makeCache(): Maps<string, number> {
  return new Maps<string, number>();
}

/**
 * A project that renders in the browser only — the same state, and no blob for it to cross.
 *
 * Nothing here imports a server entry, so the rule is not part of the run at all. Reporting a `Map`
 * in state here would be reporting a working application.
 */
class Cart extends Component {
  /* Silent: correct with no blob to cross. */
  @state byId = new Maps<string, number>();
  /* Silent for the same reason. */
  @state meta = { openedAt: new Dates() };

  /* Not reported: JSON carries these. */
  @state total = 0;
  @state rows = [];
  @state label = "cart";

  /* Silent for the same reason, one hop away: the gate is about the project, not the spelling. */
  @state shared = SHARED;
  @state fromHelper = makeCache();

  /* Not reported: `@persist` beside it means `persist-of-a-lossy-value` answers, without a gate. */
  @state @persist both = new Dates();

  render() {
    return (
      <div>
        <div>{this.label}</div>
      </div>
    );
  }
}

bootstrap(<Cart />, null);
