---
"@ramonda/check": minor
---

`--split` says what loads when, and `--diff` says what a change moved.

Both are readings of the graph that is already emitted — no second walk over the source, and no new
fact in the format. That was the argument for making the graph a product, and this is the second
time it has held.

**A bundler splits at a dynamic import and nowhere else**, so `--split` splits at a `lazy` edge and
nowhere else. What a chunk reaches comes out in three parts, each a different claim: already in the
first payload and free, shared with another split point and downloaded once for both, or its own.
Collapsing any two of them reports a page as expensive when it is free.

```
[ramonda-check] what loads when — @ramonda/docs

  before anything      16 declaration(s) in 8 file(s)
  loaded on demand     76 split point(s)
  shared between them  55 declaration(s)
```

`--diff <graph.json>` compares the run against a graph written earlier. The number it exists for:

```
  nodes  +0  -0        edges  +1  -0
  before anything: 16 → 72 declaration(s) (+56)
```

That is one added import line, measured on this repository's documentation site. A diff of the
source shows the line; nothing in it shows the fifty-six components that now arrive with the first
page. Identity leaves the LINE out on both sides, so inserting a line near the top of a file moves
nothing below it, and a graph of a different package, scope or schema is refused rather than
subtracted.

**Routes are deliberately not the unit, and that is a measurement rather than a preference.** The
plan called this "what one route pulls in". Measured: one app here imports all eleven of its pages
statically, so every one is in the first payload and opening a route downloads nothing; another
builds its route table in a loop, so no route in it has a URL this could name. The unit is where the
code actually splits.

It counts declarations and names files. It never says bytes — nothing here has weighed a bundle.
Both flags describe; neither fails a build.
