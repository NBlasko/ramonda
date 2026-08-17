---
"@ramonda/build": patch
---

The README's docs link pointed at `/reference/check`, which is a different package. `@ramonda/build`
now has a reference page of its own — what it sets, both adapters, what it refuses and why, and the
escape hatch for a bundler with no adapter here — and the link points at it.

The package also has a public-surface test now, like the other packages: `settings.ts` exports seven
names and only two are meant to leave the package, and until now nothing said so.
