---
"@ramonda/devtools": patch
"@ramonda/query": patch
---

The Query tab's buttons did nothing, and the panel is resizable now.

**Attribute values were never escaped for quotes.** A query's hash is JSON, so it carries `"` —
and `data-q-hash="["products"]"` ends the attribute at the second quote. The parser then read the
rest as bare attributes, leaving `dataset.qHash` as `[`, so **invalidate and remove looked up an
entry that cannot exist and silently did nothing**. The same broken markup is why the age element
could not be found, and why `refreshAges` threw
`Failed to execute 'querySelector': not a valid selector` four times a second — one missing
escape, three symptoms. `escapeHtml` covers `"` and `'` now, and the ages are matched through
`dataset` in JS rather than through a selector built from data.

**A query's data preview is capped at 2000 characters instead of 120.** 120 showed
`{"products":[{"id":1,"title":"Essence Masc…` and stopped there, which tells you nothing the key
did not. Both a preview and a state value scroll inside their own box now, so the cap only keeps
a megabyte of cached data off the wire.

**The panel opens at 620px and its left edge is a drag handle.** (It was a fixed 450px, set before
the panel had a nested component tree and a query table in it — both wide, both wrapping into
unreadable columns. 900px was tried in between and covered too much of the app.) The width is remembered across reloads and
clamped to 280px…96vw: no fixed default can be right for both a query table and a narrow highlight
check, so it is the reader's to set. The
content scrolls on both axes, a tree row no longer wraps, and the toolbar reflows through a
**container** query — the panel's width is dragged, not the window's, so a media query would
never fire.
