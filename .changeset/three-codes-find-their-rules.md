---
"@ramonda/check": patch
---

Three rules say which runtime code they answer

`alsoReportedAs` is how the reference cross-links a static rule to the diagnostic that reports the
same fault once the line runs. Counted across the framework: **53 runtime codes, 30 already paired,
23 with no rule at all — and three that had a rule and never said so.**

- `fresh-object-in-hook-props` answers `RMD022`, which is the same value built twice in a hook's
  props callback.
- `parent-with-a-foreign-child` and `tag-needs-its-parent` both answer `RMD028` — the same
  misplacement read from either end: a container holding a child its content model forbids, and a
  tag written outside the parent it requires. Declared as a pair, with that reason, because the
  catalogue refuses a second claimant nobody wrote down.

A reader who meets `RMD028` in a console now finds both halves from the reference instead of
neither.
