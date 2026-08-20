import { Component, memoizedHandler, state, list } from "@ramonda/core";

interface Task {
  id: number;
  title: string;
}

let nextTaskId = 1;
const makeTask = (title: string): Task => ({ id: nextTaskId++, title });

/**
 * One component, two lists. Moving a task from one side to the other removes it
 * from one `each` and adds it to the other; because identity is the Task object,
 * the moved row is the SAME instance on the far side, not a rebuilt one. No keys
 * written for either list.
 *
 * Both lists mint the same ids (`f0`, `f1`, …) — they are per-list. What keeps
 * them apart is that each is ONE entry in the parent's child record with its own
 * key index.
 */
export class TwoLists extends Component {
  @state todo: Task[] = [makeTask("wire up SSR"), makeTask("write docs")];
  @state done: Task[] = [makeTask("ship list()")];

  /**
   * Keyed by the task's `id` — not by the task itself, because `@memoizedHandler`
   * builds its cache key from primitives and throws on an object. The body resolves
   * the task from the CURRENT array when the click happens, so a reorder cannot make
   * a cached handler act on the wrong row, and identity still decides what moves
   * (`t !== task`).
   *
   * The `id` is here for the handler cache and nothing else: `list()` is given no
   * key, and works out which row is which on its own. Position would have done just
   * as well until the mapper stopped handing over an index.
   *
   * The alternative is a fresh arrow per row per render, which RMD020 reports: each
   * one is removed and re-added on its button every time the parent renders.
   */
  @memoizedHandler
  finish(id: number) {
    return () => {
      const task = this.todo.find((t) => t.id === id);
      if (!task) return;
      this.todo = this.todo.filter((t) => t !== task);
      this.done = [...this.done, task];
    };
  }

  @memoizedHandler
  reopen(id: number) {
    return () => {
      const task = this.done.find((t) => t.id === id);
      if (!task) return;
      this.done = this.done.filter((t) => t !== task);
      this.todo = [...this.todo, task];
    };
  }
  addTodo() {
    this.todo = [...this.todo, makeTask(`task #${nextTaskId}`)];
  }

  render() {
    return (
      <div className="twocol">
        <div className="col">
          <div className="row">
            <h3>To do ({this.todo.length})</h3>
            <button onclick={this.addTodo}>add</button>
          </div>
          <ul className="tasks">
            {list(this.todo, (t: Task) => (
              <li className="task">
                <span>{t.title}</span>
                <button onclick={this.finish(t.id)}>done →</button>
              </li>
            ))}
          </ul>
        </div>
        <div className="col">
          <h3>Done ({this.done.length})</h3>
          <ul className="tasks">
            {list(this.done, (t: Task) => (
              <li className="task done">
                <button onclick={this.reopen(t.id)}>← undo</button>
                <span>{t.title}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
}
