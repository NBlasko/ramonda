---
"@ramonda/core": minor
"@ramonda/server": minor
"@ramonda/check": patch
"create-ramonda": minor
---

`Head` sets `data-*` on `<html>`: `this.use(Head, (self) => ({ data: { theme: self.theme } }))` is
`<html data-theme="dark">`, by `lang`'s rules — the deeper `Head` wins per key, `undefined` says
nothing, and a page that goes away hands back what `<html>` had. `renderPage` and `renderStatic` return
`data`, `renderDocument` and `fillDocument` write it, so a theme is in the first paint. A key is
written as it follows `data-`; `colorScheme` is refused, because HTML lowercases it and no
`[data-color-scheme]` would match. The scaffolded server passes `data` through, and `dom-writes`
names it as the answer for a value that belongs on `<html>` — the docs no longer show an ignore for it.
