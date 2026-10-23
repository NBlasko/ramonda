---
"@ramonda/check": minor
"@ramonda/core": minor
---

`field-set-by-an-event` and `RMD062`: a field sent an edit while a commit runs

A field learns its model through render, and the render an edit's handler causes runs once the
commit is over. `field-set-by-an-event` reports an edit sent from the work a commit runs —
`render()`, the constructor, `@created`, `@mounted`, `@updated`, `@destroyed`, `@watchProp`,
`@catchError`, and every method of the class they call: dispatching `input`, `change`,
`beforeinput` or a composition event, or an event whose type cannot be read; a `click` on a checkbox,
a radio or a `<label>` the class renders; writing `.value` or `.checked` on a field it renders with
that model; `document.execCommand`. What runs after the commit — a microtask, a timer, a promise,
past an `await` — and an event handler are not reported: a row whose `onclick` clicks its checkbox
does what a `<label>` does.

```tsx
@state accepted = true;                    // not this.box.current?.click() in @mounted
```

`RMD062` reports the same at runtime, when a field reads its model while the render of its last edit
waits for the running commit — a second edit's `transform` reading `prev`, a word ending after
`oncompositionend` moved the model. In a development build it says what to write instead; a
production build records it for the app's collector. The edit is answered either way.
