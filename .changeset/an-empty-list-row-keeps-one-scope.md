---
"@ramonda/core": patch
---

A `list()` row whose callback produces nothing keeps one scope, used again on every pass: what it read still
brings it back when it changes, and a signal it read no longer gathers one more subscription per pass. While
nothing it read moves, the callback is not asked again, and a list handed the same array keeps taking its rows by
position with such a row in it.
