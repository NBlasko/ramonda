---
"@ramonda/core": patch
---

A module `AsyncLoad` cannot render now says so, instead of throwing at render time

`AsyncLoad` caches a module's export and later calls it — a component class is wrapped, anything else
was taken as already callable. An export that is neither reached the cache unchecked, and the failure
surfaced a render later as "loadedComponent is not a function": a line that names neither the module
nor the export, and one the error fallback never saw, because nothing had failed as far as the
loading knew. The page stayed on its loading state.

A default export that is a config object, a styles module, a barrel file, a named export pointing at
a constant — all ordinary mistakes, and the same class as a missing named export, which has always
been caught at load time and reported through the error fallback. The two now agree: the export is
checked where the module is, and the error names both the export and what was found there.
