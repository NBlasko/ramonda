---
"@ramonda/css": patch
---

Saving `ramonda.css.ts` reaches a running dev server.

It did nothing. The hot-update hook takes files that hold a block and a config holds none, so it
returned at the first line — and both halves of what the config decides were left stale, silently:

- `css-system/variables.css` is written once at `buildStart`, so a design token changed from `16px`
  to `40px` still served `16px`. It is a plain stylesheet the project imports once; nothing else was
  ever going to regenerate it.
- every already-compiled file kept the rules the old config gave it, so a narrowed `units` or a
  property switched off was not enforced until each file happened to be touched by hand.

The page was simply wrong with no word anywhere, and restarting the server was the only cure — on
the one file this package tells people to edit. Codegen re-runs now and every file holding a block
is invalidated, so the next request compiles against the config that is actually on disk.

A config saved half-typed is swallowed, the same way a block that does not compile is: the transform
reports it properly the moment anything asks for a file.
