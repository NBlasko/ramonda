import { Component, list, list as aliased, state, compute, persist, created, destroyed } from "@ramonda/core";
import { list as ownList } from "./own-list";
import { list as reExported } from "./re-export";

interface Task {
  id: string;
  title: string;
}

/** Reported: the framework's `list` under a local alias is the framework's `list`. */
export class ThroughAnAlias extends Component {
  label = "old";
  tasks: Task[] = [];

  bump() {
    this.label = "new";
  }

  row(t: Task) {
    return <li>{t.title + this.label}</li>;
  }

  render() {
    return <ul>{aliased(this.tasks, this.row)}</ul>;
  }
}

/** Reported: and so is the same `list` reached through an app's own `ui` module. */
export class ThroughAReExport extends Component {
  label = "old";
  tasks: Task[] = [];

  bump() {
    this.label = "new";
  }

  row(t: Task) {
    return <li>{t.title + this.label}</li>;
  }

  render() {
    return <ul>{reExported(this.tasks, this.row)}</ul>;
  }
}

/** Reported: a stable callback shows a written plain field. */
export class Reported extends Component {
  label = "old";
  tasks: Task[] = [];

  bump() {
    this.label = "new";
  }

  row(t: Task) {
    return <li>{t.title + this.label}</li>;
  }

  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/** Reported: the read is one hop away, through a local the return names. */
export class ThroughALocal extends Component {
  label = "old";
  tasks: Task[] = [];
  bump() {
    this.label = "new";
  }
  row(t: Task) {
    const shown = this.label;
    return <li>{t.title + shown}</li>;
  }
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/** Reported: the read is in a sibling member the callback returns through. */
export class ThroughAMethod extends Component {
  label = "old";
  tasks: Task[] = [];
  bump() {
    this.label = "new";
  }
  cell(t: Task) {
    return t.title + this.label;
  }
  row(t: Task) {
    return <li>{this.cell(t)}</li>;
  }
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/** Reported as opaque: `this` leaves. */
declare function labelOf(owner: unknown): string;
export class HandsThisOut extends Component {
  label = "old";
  tasks: Task[] = [];
  bump() {
    this.label = "new";
  }
  row(t: Task) {
    return <li>{t.title + labelOf(this)}</li>;
  }
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/** Silent: `@state`, so the read is recorded. */
export class Reactive extends Component {
  @state label = "old";
  tasks: Task[] = [];
  bump() {
    this.label = "new";
  }
  row(t: Task) {
    return <li>{t.title + this.label}</li>;
  }
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/** Silent: a `@compute` is tracked, so a row that reads one wakes with it. */
export class ComputeRead extends Component {
  @state seen = 0;
  tasks: Task[] = [];
  bump() {
    this.seen = 1;
  }
  @compute get total() {
    return this.seen * 2;
  }
  row(t: Task) {
    return <li>{t.title + this.total}</li>;
  }
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/**
 * Reported: `@persist` is NOT reactive.
 *
 * It carries a value across hydration without tracking it, so a row that shows one is as stale as a row
 * showing a plain field. This fixture said the opposite until the shared judgement was extracted and
 * `cached-read-of-a-plain-field` reported the very same field from its own side.
 */
export class PersistRead extends Component {
  @persist seen = 0;
  tasks: Task[] = [];
  bump() {
    this.seen = 1;
  }
  row(t: Task) {
    return <li>{t.title + this.seen}</li>;
  }
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/** Silent: nothing ever writes the field, so it cannot go stale. */
export class NeverWritten extends Component {
  readonly suffix = "!";
  tasks: Task[] = [];
  row(t: Task) {
    return <li>{t.title + this.suffix}</li>;
  }
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/** Silent: written only in `@created`, which runs before the first row exists. */
export class WrittenInCreated extends Component {
  label = "";
  tasks: Task[] = [];
  @created init() {
    this.label = "ready";
  }
  row(t: Task) {
    return <li>{t.title + this.label}</li>;
  }
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/** Silent: an inline callback, so every row is rebuilt and reads the field again. */
export class InlineCallback extends Component {
  label = "old";
  tasks: Task[] = [];
  bump() {
    this.label = "new";
  }
  render() {
    return (
      <ul>
        {list(this.tasks, (t) => (
          <li>{t.title + this.label}</li>
        ))}
      </ul>
    );
  }
}

/** Silent: the plain field is used for its side effect and never reaches the markup. */
declare const node: unknown;
export class SideEffectOnly extends Component {
  observer: { observe(n: unknown): void } = { observe() {} };
  seen = new Map<string, boolean>();
  tasks: Task[] = [];
  swap() {
    this.observer = { observe() {} };
    this.seen = new Map();
  }
  row(t: Task) {
    this.observer.observe(node);
    this.seen.set(t.id, true);
    return <li>{t.title}</li>;
  }
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/** Silent: the author wrote down why. */
export class Annotated extends Component {
  hovers = 0;
  tasks: Task[] = [];
  bump() {
    this.hovers++;
  }
  row(t: Task) {
    // ramonda-check-ignore a hover count, stale until the row rebuilds is fine
    return <li>{t.title + this.hovers}</li>;
  }
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/** Written in the CONSTRUCTOR — before the first render, so no row can be stale. */
export class WrittenInConstructor extends Component {
  label: string;
  tasks: Task[] = [];
  constructor() {
    super();
    this.label = "ready";
  }
  row(t: Task) {
    return <li>{t.title + this.label}</li>;
  }
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/** The memo pattern: written from inside `render()`. Advising `@state` here advises a loop. */
export class MemoInRender extends Component {
  cache: string | null = null;
  tasks: Task[] = [];
  row(t: Task) {
    return <li>{t.title + (this.cache ?? "")}</li>;
  }
  render() {
    if (!this.cache) this.cache = "built";
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/** Written in `@destroyed`, which runs after the last render. */
export class WrittenInDestroyed extends Component {
  label = "x";
  tasks: Task[] = [];
  @destroyed clean() {
    this.label = "";
  }
  row(t: Task) {
    return <li>{t.title + this.label}</li>;
  }
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/**
 * Reported: the callback is a class-field arrow, which is a stable reference too.
 *
 * `arrow-fields` reports this line as well, and both are right about different things: that rule says the
 * arrow buys nothing over a method, this one says the field it shows is not `@state`. Making it a method
 * silences the first and leaves the second, which is the point.
 */
export class ArrowCallback extends Component {
  label = "old";
  tasks: Task[] = [];
  bump() {
    this.label = "new";
  }
  row = (t: Task) => <li>{t.title + this.label}</li>;
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/**
 * Reported as unanalysable: `this` handed to a SIBLING member.
 *
 * The callee being in this very class does not help — `fmt` reads through its parameter, and nothing
 * here follows a parameter. That is why the report says "through a parameter" rather than "outside this
 * declaration", which would be false here.
 */
export class ThisToASibling extends Component {
  label = "old";
  tasks: Task[] = [];
  bump() {
    this.label = "new";
  }
  fmt(owner: unknown) {
    return String(owner);
  }
  row(t: Task) {
    return <li>{t.title + this.fmt(this)}</li>;
  }
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/** Silent: a plain getter is not a `PropertyDeclaration`, so it is not a candidate. See `stale-field.ts`. */
export class GetterOverAField extends Component {
  private raw = "old";
  tasks: Task[] = [];
  bump() {
    this.raw = "new";
  }
  get label() {
    return this.raw;
  }
  row(t: Task) {
    return <li>{t.title + this.label}</li>;
  }
  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}

/** Silent: the app's OWN `list`, from its own module. The specifier is the evidence, not the name. */
export class OwnList extends Component {
  label = "old";
  tasks: Task[] = [];
  bump() {
    this.label = "new";
  }
  row(t: Task) {
    return <li>{t.title + this.label}</li>;
  }
  render() {
    return <ul>{ownList(this.tasks, this.row)}</ul>;
  }
}

/**
 * Reported: the callback and the field both on a BASE class — one instance, one row, one stale
 * value. This rule read a single class body until it was planted against.
 */
export class RowBase extends Component<{ tasks: Task[] }> {
  protected label = "old";

  protected row(t: Task) {
    return <li>{`${t.title} ${this.label}`}</li>;
  }

  bump() {
    this.label = "new";
  }

  render() {
    return <ul />;
  }
}

export class RowsFromABase extends RowBase {
  render() {
    return <ul>{list(this.props.tasks, this.row)}</ul>;
  }
}

/** Reported: the callback is an arrow FIELD rather than a method — a stable reference all the same. */
export class ArrowFieldCallback extends Component<{ tasks: Task[] }> {
  private label = "old";

  private row = (t: Task) => <li>{`${t.title} ${this.label}`}</li>;

  bump() {
    this.label = "new";
  }

  render() {
    return <ul>{list(this.props.tasks, this.row)}</ul>;
  }
}
