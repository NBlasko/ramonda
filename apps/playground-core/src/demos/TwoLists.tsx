import { Component, memoizedHandler, state, list } from "@ramonda/core";

interface Task {
  title: string;
}

let nextTaskId = 5;
const makeTask = (title: string): Task => ({ title });

/**
 * One component, two lists. Moving a task from one side to the other removes it
 * from one `each` and adds it to the other; because identity is the Task object,
 * the moved row is the SAME instance on the far side, not a rebuilt one. No keys
 * written for either list.
 *
 * Both lists mint the same ids (`f0`, `f1`, …) — they are per-list. What keeps
 * them apart is that each is ONE entry in the parent's child record with its own
 * key index; see BUGS.md in packages/core.
 */
export class TwoLists extends Component {
  @state todo: Task[] = [makeTask("wire up SSR"), makeTask("write docs")];
  @state done: Task[] = [makeTask("ship list()")];

  /**
   * Keyed by the row's INDEX, which the mapper already hands over — not by the task
   * itself, because `@memoizedHandler` builds its cache key from primitives and
   * throws on an object. The body resolves the task from the CURRENT array when the
   * click happens, so a reorder cannot make a cached handler act on the wrong row,
   * and identity still decides what moves (`t !== task`).
   *
   * The alternative is a fresh arrow per row per render, which RMD020 reports: each
   * one is removed and re-added on its button every time the parent renders.
   */
  @memoizedHandler
  finish(index: number) {
    return () => {
      const task = this.todo[index];
      if (!task) return;
      this.todo = this.todo.filter((t) => t !== task);
      this.done = [...this.done, task];
    };
  }

  @memoizedHandler
  reopen(index: number) {
    return () => {
      const task = this.done[index];
      if (!task) return;
      this.done = this.done.filter((t) => t !== task);
      this.todo = [...this.todo, task];
    };
  }
  addTodo() {
    this.todo = [...this.todo, makeTask(`task #${nextTaskId++}`)];
  }

  render() {
    return (
      <div className="twocol">
        <div className="col">
          <div className="row">
            <h3>To do ({this.todo.length})</h3>
            <button onClick={this.addTodo}>add</button>
          </div>
          <ul className="tasks">
            {list(this.todo, (t: Task, i: number) => (
                <li className="task">
                  <span>{t.title}</span>
                  <button onClick={this.finish(i)}>done →</button>
                </li>
              ))}
          </ul>
        </div>
        <div className="col">
          <h3>Done ({this.done.length})</h3>
          <ul className="tasks">
            {list(this.done, (t: Task, i: number) => (
                <li className="task done">
                  <button onClick={this.reopen(i)}>← undo</button>
                  <span>{t.title}</span>
                </li>
              ))}
          </ul>
        </div>
      </div>
    );
  }
}
