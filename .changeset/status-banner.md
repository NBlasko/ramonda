---
"@ramonda/query": patch
---

The status banner states the plan instead of apologising — and stops claiming `0.0.x`.

Both READMEs said "Status: early … versions are `0.0.x`", which was false (core and query are past 0.2.0)
and, worse, said nothing about what happens next. Someone reading it learns the API is unstable but not
whether that is a phase or a temperament.

It is a phase, and it now says so: `0.x` is exploration, where the API changes freely between releases and
the packages are on npm to be installed and tried rather than adopted. **At `1.0` that flips** —
interfaces hold, backward compatibility becomes a rule rather than a courtesy, and the work turns to
performance and bugs. The whole point of the `0.x` months is to arrive at an API worth keeping still.

Also corrected in `.github/workflows/README.md`, which still described the first publish in the future
tense ("the packages are not on npm yet").
