---
"@ramonda/core": minor
"@ramonda/devtools": minor
---

Edit a `@state` value from the panel.

**✎** on a state row opens the value as JSON in place: Enter applies, Escape abandons, and a
multi-line value takes ⌘/Ctrl+Enter so plain Enter stays a newline. Invalid JSON never reaches the
app — the parse happens first and the row says what was wrong.

The write side of the bridge is deliberately narrow: **one field, addressed by a handle the last scan
handed out, and only when that field is `@state` or `@persist`.** There is no way through it to an
instance, a method, or a prop. A handle from an older scan is refused rather than landing on whatever
now occupies that slot.

Two limits are the framework's rules, not the panel's, and both are stated in the UI:

- **You edit the whole field.** A signal holds a value, not a proxy, so mutating inside an object
  notifies nobody: "change `user.name`" has to become "assign a new `user`". The panel is held to the
  same rule as application code.
- **Props have no pencil.** They are owned by whoever rendered the component and assigning to one
  throws in every build (RMD004 / RMD015). A box that pretended otherwise would either throw or look
  like it had worked until the next render put the old value back. Same for a hook's props, which come
  from its owner's callback. Core refuses the write; the panel does not offer it and says why if it is
  attempted.

A value that cannot survive a round trip through JSON — a function, a `Map`, a DOM node — gets no
pencil either, rather than a box that fails on Enter. The write itself goes through the ordinary
setter, so the signal notifies, the component rebuilds, `@updated` runs, and a diagnostic fires for a
non-serializable value, exactly as if the app had assigned it.
