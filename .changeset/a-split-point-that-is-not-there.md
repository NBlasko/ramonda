---
"@ramonda/check": minor
---

`ramonda-check` reports a dynamic import the bundler cannot split.

A bundler splits at a dynamic import and nowhere else, and only when it can read the path at build
time. `import(specifier)` is therefore not a split point: the module is pulled into the caller's
chunk, or left out of the build entirely and looked for at run time — which works on a dev server,
where the source is served as it sits, and 404s in production, where nothing emitted it. Nothing
says so today.

It is silenced by either annotation, and both are honoured for different reasons.
`import(/* @vite-ignore */ name)` is the bundler's own marker: the rule's premise is that nothing
tells you, and at a site carrying that one the bundler told the author and the author answered.
`// ramonda-check-ignore why` is this package's own, and it keeps the reason visible in every run.

Measured across this repository before the rule was written: 88 dynamic imports with a literal path,
3 without, and all three already marked. It reports nothing here, and reports the fault the moment a
marker is taken off — both checked.

`AnalyzeResult` gains `dynamicImportPaths`, and `UnsplittableImportIssue` is exported alongside it.
This is the first rule that reads a FILE rather than a class: a question about what a module imports
has no class to hang off.
