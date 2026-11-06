---
"@ramonda/check": minor
---

The checker now sees what the runtime's RMD020, RMD021 and RMD022 report, measured shape by shape:

- A hook's props callback read through its parameter — `(self: App) => self.tick`, the way the docs write it — or with the parameter destructured. `fresh-object-in-hook-props` and `cached-read-of-a-plain-field` recognised only `this.`, and were silent on that shape. A value is reported only where a reactive read OUTSIDE it can rebuild it, so `key: ["todo", self.props.id]` stays silent.
- A value built by a call as a prop: `.filter()`, `.map()`, `.slice()`, `.concat()` and the other array methods that return a new array, `Object.assign({}, x)`, `Object.keys`/`entries`/`values`/`fromEntries`, `Array.from`, `structuredClone`, and any `new X()`.
- `this.save.bind(this)` in the markup, as `function-built-in-the-markup`.
- `crypto.randomUUID()` and `crypto.getRandomValues()` in a render, as `clock-read-while-rendering`.
- `function-built-in-hook-props`, a new error: a function built in a hook's props callback that runs again, such as `fetch: () => self.load()`. The answer is a method, `fetch: self.load`.
