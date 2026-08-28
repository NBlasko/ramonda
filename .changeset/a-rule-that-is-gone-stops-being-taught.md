---
"@ramonda/core": patch
"@ramonda/query": patch
"@ramonda/router": patch
"@ramonda/testing-library": patch
---

The retired one-element rule stops being taught, including in a message readers see

`Every JSX tag is exactly one element` was the framework's headline rule and is not
true any more — a component renders one element, several, or none. The rule was
retired; the sentences arguing FROM it were not, and they were spread across four
packages.

The one that reached users: the fragment error said `<>…</>` is refused because it
`would make one tag produce several elements`. That is now something a component
does routinely, so the message argued from a rule the framework no longer has. It
gives the reason that still holds — a fragment has no state, no lifecycle and no
identity the diff can hold, and a component covers every case it would.

The rest were comments and one reference page, each rewritten to the reason that
survives rather than deleted: `RMD011` and its DEV guard, `__h`'s contract (one
vnode per tag, which is a claim about the vnode and not about the DOM), why
`createContext`, `QueryClientProvider` and `Router` are hooks (they put nothing on
the page — not that a wrapper was forbidden), and why attribute names are not
aliased.

Two comments also described `<ramonda-host>`, which no longer exists anywhere in
the source. `AsyncLoad` renders the loaded module and nothing around it.
