---
"@ramonda/css": patch
---

Nothing asserted what six of this package's eight entries export, and one of them is
`@ramonda/css/properties` — where `CssBlock` lives, and the entry this release reshaped most.

The surface test said so itself: *there are two entries*. There are eight. `.` and `./compiler` were
listed and `./config`, `./properties`, `./vite`, `./esbuild`, `./plugin` and `./prettier` were not,
so a name could be added to any of them, or lost from one, with nothing to say so.

All eight are listed now, read from source — `Object.keys` cannot see a type, and `./properties` is
nothing but types. Seen to fail: a type added to `properties.ts` is reported.
