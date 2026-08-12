---
"@ramonda/core": major
---

`list()` takes two arguments, and `key` is gone.

```diff
-list({ each: this.todo, as: TaskRow })
+list(this.todo, TaskRow)

-list({ each: this.rows, render: (r) => <li>{r.t}</li> })
+list(this.rows, (r) => <li>{r.t}</li>)

-list({ each: this.users, key: (u) => u.id, as: UserRow })
+list(this.users, UserRow)
```

The options bag had one field left worth having. `key` stopped covering anything when identity started being carried on the item — a refetch keeps its rows without one — and `as` and `render` were always mutually exclusive, which is a shape that can be written wrong. Two positional arguments cannot be: the items, and the one way to turn an item into markup.

The second argument is a component or a function, and nothing has to declare which. A class has a construct signature and no call signature, an arrow the reverse, so the two overloads are mutually exclusive with no union; at runtime the class is recognised by the `__isComponent` static that `Component` already carried.

`RMD014` (both given, or neither) is retired — neither mistake is expressible. `ListOptions` is replaced by `Each`, `ItemRender` and `ItemComponent`.

Also fixed: minted ids now come from the process-wide counter rather than a per-list one. A per-list counter was safe while an id never left its region; identity travels with the item now, so the same object shown in a second list carried an id that list had already minted for a different row.
