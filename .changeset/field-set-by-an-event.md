---
"@ramonda/check": minor
"@ramonda/core": minor
---

`field-set-by-an-event` and `RMD062`: a field sent an edit while a commit runs

A field learns its model through render, and the render an edit's handler causes runs once the commit
is over. `field-set-by-an-event` reports an edit sent from the work a commit runs — `render()`, the
constructor, `@created`, `@mounted`, `@updated`, `@destroyed`, `@watchProp`, `@catchError`, a ref's
callback (`createRef(this.attached)`), and every method and accessor of the class they use:
dispatching `input`, `change`, `beforeinput` or a composition event — or one whose type cannot be
read — at a field the class renders, an element a query finds or one a form's `elements` hands; a
`click` on a checkbox, a radio or a `<label>` of one the class renders; writing `.value` or
`.checked` on a field it renders with that model; `document.execCommand`. What is handed to run after
the commit — a microtask, a timer, a promise's `then` — an event handler, and an event dispatched at
the document or a store are not reported: a row whose `onclick` clicks its checkbox does what a
`<label>` does. An `async` hook is read whole: whether a statement runs before an `await` or after it
depends on values, so an edit past one is handed to `queueMicrotask` to say it is meant for later.

```tsx
@state accepted = true;                    // not this.box.current?.click() in @mounted
```

`RMD062` reports the same at runtime, when a field reads its model while the render of its last edit
waits for the running commit — a second event in the same commit, which cannot know whether the
handler took the first edit or refused it. In a development build it says what to write instead; a
production build records it for the app's collector. The edit is answered either way.
