---
"@ramonda/core": minor
---

Two lazies built by one factory no longer share a cache entry — RMD035

`AsyncLoad` identifies a module by the SOURCE of its `lazy`. A lazy a factory built —
`const make = (path) => () => import(path)` — closes over the path, and the closed-over value is not
part of the source, so every module the factory produces stringifies the same. The first loaded and
cached; the second never asked for its own and rendered the first one's module. Nothing failed,
nothing was logged, and which module you got depended on which rendered first.

The source cannot tell them apart, but the FUNCTION can: two lazies that collide are two different
function objects with the same text. A derived key is now claimed by the function that first uses it,
and a different function arriving at the same key is given one of its own — so it loads the module it
asked for. One `lazy` handed to two `<AsyncLoad>`s is the same object, so ordinary sharing is
untouched.

What the minted key costs is the shared cache entry: a loading frame the second time, since the
module system still dedupes the fetch. `cacheKey` gives it back, and RMD035 says so.
