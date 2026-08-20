import {
  Component,
  Host,
  bootstrap,
  created,
  memoizedHandler,
  mounted,
  persist,
  state,
  updated,
  watchProp,
} from "../framework";

declare const rows: { id: string; label: string }[];

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
  @memoizedHandler byObject(arg: { id: string }) {
    return () => arg.id;
  }

  /* REPORTED — declared to take an array. */
  @memoizedHandler byArray(arg: string[]) {
    return () => arg.length;
  }

  /* Not reported: a type reference says nothing this can read without asking for a type. */
  @memoizedHandler byRef(arg: string) {
    return () => arg;
  }

  render() {
    return (
      <ul>
        {/* REPORTED — a literal argument, and a cast changes nothing about what is passed. */}
        <li onClick={this.byRef({ id: "x" } as never)}>a</li>
        {/* REPORTED — null is not a key either. */}
        <li onClick={this.byRef(null as never)}>b</li>
        {/* Not reported: an expression this cannot read. `this.byRef(row.id)` is right and
            `this.byRef(row)` is the fault, and they look the same from here. */}
        <li onClick={this.byRef(rows[0].id)}>c</li>
        {/* Not reported: a primitive. */}
        <li onClick={this.byRef("k")}>d</li>
      </ul>
    );
  }
}

bootstrap(<Panel />, null);
