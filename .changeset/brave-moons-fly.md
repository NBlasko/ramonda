---
"@ramonda/core": minor
---

Two lazies built by one factory no longer share a cache entry — RMD035

`AsyncLoad` identifies a module by the SOURCE of its `lazy`, which works when that source names one:
`() => import("./Thing")` says what it loads, so the same import written in two components shares one
cache entry — which is what you want. A lazy a FACTORY built names nothing —
`const make = (path) => () => import(path)` closes over the path, and a closed-over value is not part
of the source, so every module the factory produces stringifies the same. The first loaded and
cached; the second never asked for its own and rendered the first one's module. Nothing failed,
nothing was logged, and which module you got depended on which rendered first.

Which of the two you have written cannot be read from the text of the function: the source a bundler
leaves behind is its own business, and a rule looking for a literal specifier would read one
bundler's output correctly and another's backwards. So nothing is guessed. When a second `lazy` meets
a key that is already taken, its module is loaded and COMPARED — the module system serves a genuine
duplicate from its own registry, so the ordinary case pays one resolved promise and confirms the
sharing. A module that turns out to be a different one is given a key of its own, and renders what it
asked for.

What that costs is the shared cache entry: a loading frame the second time, since the fetch is still
deduped. `cacheKey` gives it back, and RMD035 says so.
