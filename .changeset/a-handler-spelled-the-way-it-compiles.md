---
"@ramonda/core": patch
"@ramonda/check": patch
---

Every example spells a handler the way the framework accepts it

A host element's event handler is `on` plus the DOM's own event name, lowercase — `onclick`,
`oninput`, `onsubmit`. The capitalised form is refused by the types, and the refusal names the
spelling to use.

The prose had not followed. Nine docstrings across four packages wrote the capital, and two of
them are strings a developer reads rather than comments: RMD020's fix text, printed whenever a
function is built inside `render()`, offered `onClick={this.submit}` as the shape to move to — and
a reader who copied it got a compile error from the framework that had just told them what to
write. `link-without-a-destination` named the same spelling in the line it prints beside an `<a>`
with no `href`.

Nothing could catch it. A comment is not typechecked, a fix string is not code, and the gate that
would have refused the spelling — the documentation's own typecheck — skips a one-line example.
`pnpm check:events` closes that: it reads the event names out of TypeScript's `lib.dom.d.ts`, the
same declaration the handler types are mapped over, so it cannot fall out of step with what the
types accept.

Two lines that assert RMD020 "names the handler" were passing on the fix text rather than on the
name, and had never checked what they claimed. They read the attribute now.
