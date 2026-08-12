---
"@ramonda/core": minor
---

`.map()` is no longer discouraged — `RMD023` asks for a key instead.

It used to say "use `list()` instead", and only for components, on the reasoning that plain markup survives being matched by position because the diff patches the text. That is true of the text and false of everything else on the element: an `<input>` inside a plain `<li>` holds a caret, a selection and whatever the user typed, and those follow the node.

So a `.map()` is a supported way to render a list, and what it needs is the thing every framework asks for here. `RMD023` now asks for a key, for any element, and mentions `list()` as the lazier shape rather than the required one. It drops from `error` to `warning`.

What a missing key costs is only which row *inside* the array is which — rows built from an array cannot be confused with the siblings around them, keyed or not, because every array in JSX becomes its own group with its own key space.
