import { Component, Host, state, list } from "@ramonda/core";

interface Task {
  title: string;
  done: boolean;
}

// One row. The `as` shorthand hands it the item as an `item` prop, so there is
// no per-item closure to write anywhere.
@Host("li")
class TaskRow extends Component<{ item: Task }> {
  // Proves identity: each row keeps its own count across reorders. If the diff
  // matched rows by POSITION, these numbers would follow the position instead of
  // the task, which is exactly the bug a hand-written key gets wrong.
  @state clicks = 0;

  bump() {
    this.clicks = this.clicks + 1;
  }

  render() {
    return (
      <span className={this.props.item.done ? "done" : ""}>
        {this.props.item.title}{" "}
        <button type="button" onClick={this.bump}>
          clicked {this.clicks}×
        </button>
      </span>
    );
  }
}

// `list()` is a FUNCTION in an expression slot, not a component — Ramonda is
// 1-1, so a <List> tag would have to BE an element and could not put N siblings
// into the parent. It returns a descriptor the diff understands; the component
// keeps its single host.
//
// Note what is NOT here: a key. Identity comes from the item itself (its object
// reference), so there is nothing to write and nothing to get wrong. A wrong key
// is an accident; using .map() is a decision.
@Host("div")
export class ListDemo extends Component {
  @state tasks: Task[] = [
    { title: "write the docs", done: false },
    { title: "fix the diff", done: true },
    { title: "ship it", done: false },
  ];

  shuffle() {
    // A new array of the SAME objects. Identity is the object, so every row
    // moves with its own state.
    this.tasks = [...this.tasks].reverse();
  }

  add() {
    this.tasks = [...this.tasks, { title: `task ${this.tasks.length + 1}`, done: false }];
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          <button type="button" onClick={this.shuffle}>
            reverse the list
          </button>
          <button type="button" onClick={this.add}>
            add one
          </button>
          <span className="demo-note">click a few counters, then reverse — each count moves with its task</span>
        </p>
        <ul className="demo-list">{list(this.tasks, (item) => <TaskRow item={item} />)}</ul>
      </div>
    );
  }
}
