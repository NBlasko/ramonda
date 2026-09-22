---
"@ramonda/css": patch
---

The two rules that read a style prop's type now run in the editor, not only in CI.

`style-prop-never-used` and `style-prop-overridden` need a `ts.Program`, and the language service
has one — so there was never a reason to make them a thing you meet on a push, after you have
stopped thinking about the code.

Asked for one file rather than for the project, which is sound as well as cheap: a slot's scope is
the class or function declaring it, and a spread and the declaration below it are one block, so
neither rule reaches past the file it is given. Measured at 0.15 ms for one call on a real 605-line
file.

A reduced editor server never reaches them — `getSemanticDiagnostics` is refused outright in
`PartialSemantic` mode and a `Syntactic` service has no program at all — so neither rule can misfire
where types cannot be resolved.
