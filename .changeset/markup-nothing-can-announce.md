---
"@ramonda/check": minor
---

Four accessibility rules, reading your JSX one element at a time.

`alt-text` — an `img`, `area`, image `input` or empty `object` that nothing can announce.
`empty-landmarks` — a heading or a link with nothing inside it. `frame-title` — an `iframe` with no
name. `positive-tabindex` — a `tabIndex` above zero, which does not move one element but creates a
second tab order running before the whole document's.

All four are warnings, and all four are quiet across this repository — measured on `apps/docs`,
`playground-core`, `devtools` and `core`, and checked by taking the `alt=""` off a real `<img>` and
watching the report appear at its line.

They are the first rules that read a JSX ELEMENT, so `ElementRule` joins `Rule` and `ModuleRule`:
`alt` on an `<img>` is a question about a tag, not about a class or a module, and there are dozens
more of them coming. One walk serves all of them — the analyzer visits each element once, builds
the context once, and hands the pair to every active rule.

**An element that spreads props is handed to no rule at all.** `<img {...rest} />` may carry the
attribute in question and nothing static can say whether it does, so the silence contract is applied
once for the whole family rather than remembered by each rule. `alt=""` is likewise never reported:
it is the documented way to mark an image decorative.

`AnalyzeResult.findings` gains `alt-text`, `empty-landmarks`, `frame-title` and `positive-tabindex`,
with `UnnamedImageIssue`, `EmptyHeadingOrLinkIssue`, `UnnamedFrameIssue` and `PositiveTabIndexIssue` exported
alongside.
