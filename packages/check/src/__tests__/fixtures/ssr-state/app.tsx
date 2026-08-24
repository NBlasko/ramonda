import { renderToString } from "@ramonda/core";
import { Component, Hook, bootstrap, compute, persist, state } from "@ramonda/core";

import { Dates, Maps } from "./kinds";
import { heldCache, level1, makeCache } from "./make";
import { wrap } from "./wrap";

/** Module scope changes nothing about what JSON does to a value. */
const SHARED = new Maps<string, number>();

declare const flag: boolean;

/**
 * A project that renders on a server, so state has a blob to cross.
 *
 * `renderToString` is imported here and that is the whole gate — an IMPORT, once, the same argument
 * `needs` makes about a package.
 *
 * C1/C3 — the field below is declared on the BASE and used by the subclass, and is reported once,
 * here, rather than once per class that inherits it.
 */
class Storefront extends Component {
  @state inherited = new Maps<string, number>();
}

class Cart extends Storefront {
  /* REPORTED — a `Map` arrives as `{}`. */
  @state byId = new Maps<string, number>();
  /* REPORTED — the commonest shape: lossy one level inside a literal. */
  @state meta = { openedAt: new Dates() };

  /* Not reported: JSON carries these. */
  @state total = 0;
  @state rows = [];
  @state label = "cart";

  /* The same value one hop away, which is where a refactor leaves it. */
  @state cast = new Maps<string, number>() as Maps<string, number>;
  @state shared = SHARED;
  @state fromHelper = makeCache();
  @state deep = level1();
  @state held = heldCache();
  @state branched = flag ? new Maps<string, number>() : null;
  @state fallback = null ?? new Dates();
  /** Two names deep: the report has to name the inner one, not the one already on this line. */
  @state wrapped = wrap();

  /* Not reported: `@persist` beside it means `persist-of-a-lossy-value` answers, without a gate. */
  @state @persist both = new Dates();

  /* Not reported: not state at all, so nothing puts it in the blob. */
  notState = new Maps<string, number>();

  /* Not reported: a `@compute` is derived on the side that reads it, and is in no blob. */
  @compute get derived() {
    return new Maps<string, number>();
  }

  render() {
    return (
      <div>
        <div>{this.label}</div>
      </div>
    );
  }
}

/** A hook's state crosses the same blob a component's does. */
class Session extends Hook {
  @state started = new Dates();
}

bootstrap(<Cart />, null);
void renderToString;
void Session;
