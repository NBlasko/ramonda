---
"@ramonda/core": minor
---

`list()` uses the key you write, and its callback no longer takes an index.

Which row is which is now answered in three steps, and the first two are exact. **The object** — while a row is the same object it is the same row, which covers every update that keeps its references. **Your key** — the moment an object is new (a refetch, a `for`/`push` in a `@compute`) the object cannot answer, and a `key` on the vnode is what still can. **A guess** — with no key and a new object, the incoming array is aligned against the one on screen by what the rows still have in common.

A key used to be accepted and then silently overwritten with the list's own id. It is now left exactly as written, and the list fills one in only when there is none, so a list that declares nothing behaves as it did.

Two rows under one key are reported (`RMD002`). The same OBJECT twice is not a collision — those rows are told apart by which occurrence they are, as always.

**Breaking.** The second argument is always a function; passing a component class directly is gone, because that form leaves nowhere to put a key. And the callback takes the item alone — no index. A row that shows its position had to be rebuilt whenever it moved, and an index is the one thing that must never become a row's identity. Resolve the position where the data is built instead.

```diff
-list(this.rows, TaskRow)
+list(this.rows, (task) => <TaskRow key={task.id} item={task} />)

-list(this.cells, (cell, index) => <td data-label={labels[index]}>{cell}</td>)
+// pair the label with the cell in a @compute, then
+list(this.labelled, (at) => <td data-label={at.label}>{at.cell}</td>)
```
