import {
  Component,
  Host,
  bootstrap,
  created,
  memoized,
  mounted,
  persist,
  state,
  updated,
  watchProp,
} from "../framework";

declare const rows: { id: string; label: string }[];

/** A key built in a helper, which is how an object reaches a cache without looking like one. */
function keyFor(id: string): { id: string } {
  return { id };
}

/** Built once at module scope — stable, and still not something a key can hold. */
const SHARED_KEY = { id: "x" };

/**
 * Two decorators on one member, and a memoized handler that cannot be keyed.
 *
 * The silence half is most of it: two decorators doing DIFFERENT work on one member is an idiom,
 * not a fault, and the runtime is silent about every one of those.
 */
@Host("div")
class Panel extends Component {
  /* REPORTED — `@state` already puts a field in the blob, so `@persist` adds nothing. */
  @state @persist both = 0;

  /* Not reported here: the same decorator twice is `duplicate-decorators`' report, which says
     more about it than this rule could. Two reports on one line teaches a reader to skim past. */
  @state @state twice = 0;

  /* Not reported: different work, on purpose, and the framework is silent about all of these. */
  @created @mounted seed() {}
  @watchProp((p) => p.id) @updated onIt() {}

  /* Not reported: one decorator. */
  @persist alone = 0;
  @state plain = 0;

  /* REPORTED — declared to take an object, so no call to it can ever be keyed. */
  @memoized byObject(arg: { id: string }) {
    return () => arg.id;
  }

  /* REPORTED — declared to take an array. */
  @memoized byArray(arg: string[]) {
    return () => arg.length;
  }

  /* Not reported: a type reference says nothing this can read without asking for a type. */
  @memoized byRef(arg: string) {
    return () => arg;
  }

  render() {
    const local = { id: "x" };
    return (
      <ul>
        {/* REPORTED — a literal argument, and a cast changes nothing about what is passed. */}
        <li onclick={this.byRef({ id: "x" } as never)}>a</li>
        {/* REPORTED — null is not a key either. */}
        <li onclick={this.byRef(null as never)}>b</li>
        {/* Not reported: an expression this cannot read. `this.byRef(row.id)` is right and
            `this.byRef(row)` is the fault, and they look the same from here. */}
        <li onclick={this.byRef(rows[0].id)}>c</li>
        {/* Not reported: a primitive. */}
        <li onclick={this.byRef("k")}>d</li>
        {/* REPORTED — an object one line up; the argument is followed to where it came from. */}
        <li onclick={this.byRef(local as never)}>e</li>
        {/* REPORTED — an object a helper returns. */}
        <li onclick={this.byRef(keyFor("x") as never)}>f</li>
        {/* REPORTED — a module const: STABLE, and still not something a key can hold. */}
        <li onclick={this.byRef(SHARED_KEY as never)}>g</li>
        {/* REPORTED — one arm of a ternary is enough; that path throws. */}
        <li onclick={this.byRef((rows.length ? { id: "x" } : "k") as never)}>h</li>
      </ul>
    );
  }
}

/**
 * The handler on a BASE, the call in the subclass — one instance, one cache.
 *
 * Planted to find out whether the call-site half sees a `@memoized` it did not declare.
 */
class HandlerBase extends Component {
  @memoized pick(key: string) {
    return () => void key;
  }
  render() {
    return <span />;
  }
}

class CallsTheBase extends HandlerBase {
  render() {
    /* An object where a key belongs, through a handler the BASE declares. */
    return <span onclick={this.pick({ id: "x" } as never)} />;
  }
}

bootstrap(<Panel />, null);
bootstrap(<CallsTheBase />, null);
