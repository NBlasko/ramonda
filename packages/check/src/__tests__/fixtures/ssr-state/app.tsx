import { renderToString } from "@ramonda/core";
import { Component, Host, bootstrap, persist, state } from "../framework";

declare class Maps<K, V> {
  get(key: K): V;
}
declare class Dates {
  getTime(): number;
}

/**
 * A project that renders on a server, so state has a blob to cross.
 *
 * `renderToString` is imported here and that is the whole gate — an IMPORT, once, the same argument
 * `needs` makes about a package.
 */
@Host("div")
class Cart extends Component {
  /* REPORTED — a `Map` arrives as `{}`. */
  @state byId = new Maps<string, number>();
  /* REPORTED — the commonest shape: lossy one level inside a literal. */
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
void renderToString;
