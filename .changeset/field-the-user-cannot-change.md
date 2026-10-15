---
"@ramonda/check": minor
---

`field-the-user-cannot-change`: a `Select` or `TextArea` whose `value` nothing moves

Core settles a field with `value` from the model after every input, so a field the model never
follows undoes every input. Reported, with which of three it is: `value` and no `oninput` /
`onchange`; a `TextArea` with `value` and only `onchange`, which comes on blur, so every keystroke is
undone before it; and `value` beside `defaultValue`, where `defaultValue` says nothing. The advice
is a handler that moves the model, or `defaultValue` for a field the form sends. Not reported: an
element with a spread, since `{...bind}` from `@ramonda/form` carries the handler; a `readonly` or
`disabled` field, which takes no input; and a field with a handler on an element around it.

`option-that-cannot-choose` names `defaultValue` for a choice the user owns, and
`fresh-object-in-props` says what core compares by content now.
