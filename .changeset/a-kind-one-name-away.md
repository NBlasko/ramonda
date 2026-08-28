---
"@ramonda/check": patch
---

`media-with-no-captions` reads a `<track kind>` held in a name

The rule walked the track's attributes itself and accepted only a string literal, so
`<track kind={CHAPTERS}>` with `const CHAPTERS = "chapters"` counted as a usable track and silenced
the report — while the identical `kind="chapters"` on the line above it was reported. The same
claim, spelled two ways, answered two ways.

It reads the child through `contextFor` now, which follows a name to the value it holds. That was
the fourth private attribute walk of a shape the shared readers exist to prevent, and it is the
last one.

Two facts stop hiding behind one `undefined` while it is being fixed: a track with NO `kind` defaults
to `subtitles` and carries the words, while one whose `kind` cannot be read is a track nothing here
can judge. Both still silence the rule, and `descendantIn` now hears which is which. A `<track>`
beside a spread joins the second group — the spread may carry the `kind`, or replace the one
written.

Also written down, because it reads like an oversight and is not: a `<audio muted>` is still
reported where a `<video muted>` is not. That escape is about the decorative background loop —
autoplaying, silent by design, nothing to hear at any point. A muted `<audio>` is audio somebody
will unmute with the controls, so the words are still coming.
