import { Component, list, state, compute, persist, created } from "../framework";

interface Task {
  id: string;
  title: string;
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

/** Silent: `@compute` and `@persist` are the other two that count. */
export class ComputeAndPersist extends Component {
  @persist seen = 0;
  tasks: Task[] = [];
  bump() {
    this.seen = 1;
    this.total = 2;
  }
  @compute get total() {
    return this.seen;
  }
  row(t: Task) {
    return <li>{t.title + this.total + this.seen}</li>;
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
