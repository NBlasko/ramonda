---
"@ramonda/check": minor
---

A new rule: `media-with-no-captions`.

Everything else on a page can be read by somebody who cannot hear it. A media element cannot: its
content **is** the sound, and without a `<track>` there is no text of it anywhere — not for a deaf
reader, not for somebody with the sound off, and not for the search index.

`captions`, `subtitles` and a `<track>` with no `kind` at all (which defaults to `subtitles`) all
carry the words and silence the report; `chapters` and `metadata` are navigation and do not.

`<video muted>` is **not** reported — there is no sound to caption. That is the decorative
background loop, the commonest `<video>` on a page that has one, and would otherwise be the
commonest false report this rule could make. Children it cannot read (`{tracks}`) may well be the
track, so those are left alone too.
