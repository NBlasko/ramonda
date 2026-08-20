---
"@ramonda/check": patch
---

The render walk claimed "by any path" and followed one kind of call. Four more were planted, and
every one of them reported nothing:

- an arrow **field** — `helper = () => { … }` — which is a property rather than a method, so the
  lookup for a `MethodDeclaration` ended the walk without a word. Not an exotic shape: it is the one
  `arrow-fields` exists to talk about, so a codebase that has any at all has them being called.
- a **getter**, which is read rather than called. `{this.total}` runs `get total()` right there, so
  a clock read or a state write inside it happens during the render exactly as one in a method does.
- **`super.method()`**, whose callee is not `this`.
- a **static**, `App.helper()` — walked with `this` meaning the constructor rather than the
  instance, so a write through it is nobody's state and only what does not depend on `this` counts.

The runtime reports all four, because `renderPhase.component` is set whatever the path was. So this
is `state-written-while-rendering` and `clock-read-while-rendering` catching up with what they
already said they did — they are the two rules built on the walk, and any rule built on it later
inherits the four paths for nothing.

Nothing new is reported in this repository's four applications — the shapes are correct code there —
and the fixture proves each one can speak.
