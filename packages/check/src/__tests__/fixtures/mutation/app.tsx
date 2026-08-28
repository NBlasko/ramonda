import { Component, Host, bootstrap, mounted, state } from "@ramonda/core";

declare class Dates {
  setHours(n: number): void;
}

/**
 * A `@state` value changed in place, beside every shape that must stay quiet.
 *
 * The silence half mirrors `debug/mutationGuard.ts` boundary for boundary, on purpose: the guard
 * wraps only plain objects and arrays, and lets every non-mutating array method through. A rule
 * drawing its own line would disagree with the runtime about a line of somebody's code.
 */
class Cart extends Component {
  @state items: number[] = [];
  @state user = { name: "a" };
  @state count = 0;
  /* Not a plain object, so the guard leaves it alone and so does this. */
  @state when = new Dates();
  /* Not state at all. */
  plain: number[] = [];

  @mounted seed() {
    /* REPORTED — three ways of changing a value the signal already holds. */
    this.items.push(1);
    this.user.name = "b";
    this.items[0] = 2;
  }

  fine() {
    /* The fix: a new value, so the signal fires. */
    this.items = [...this.items, 1];
    this.user = { ...this.user, name: "c" };
    /* Not mutators — they return a new value, which is the fix rather than the fault. */
    this.items.map((n) => n);
    this.items.filter((n) => n > 0);
    this.items.slice(0, 1);
    /* An ordinary assignment to state. */
    this.count = this.count + 1;
    /* Not state, and not a plain object. */
    this.plain.push(1);
    this.when.setHours(0);
  }

  render() {
    return (
      <div>
        <div>{this.items.length}</div>
      </div>
    );
  }
}

/**
 * The state is on a BASE, the mutation is in the subclass — one instance, one signal.
 *
 * `stateFieldsOf` walks the chain, so `rows` is known to be state. Which fields hold an ARRAY was
 * read from this class body alone, so the declaration on the base was never seen and the push went
 * unreported: a rule that knew the field was state and not what it held.
 */
class Inventory extends Component {
  @state rows: number[] = [];
  @state owner = { name: "a" };

  render() {
    return (
      <div>
        <div>{this.rows.length}</div>
      </div>
    );
  }
}

@Host("div")
class Restocked extends Inventory {
  @mounted seed() {
    /* REPORTED — the base's array, changed in place. */
    this.rows.push(1);
    /* REPORTED — the base's object, changed in place. */
    this.owner.name = "b";
  }

  fine() {
    /* The fix, and it must stay quiet. */
    this.rows = [...this.rows, 1];
  }
}

bootstrap(<Cart />, null);
bootstrap(<Restocked />, null);
