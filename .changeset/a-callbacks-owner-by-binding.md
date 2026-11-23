---
"@ramonda/check": patch
---

Every rule that reads a hook's props callback names its owner by what a name resolves to: an inner
parameter of the same name as a destructured one — `({ tick }) => [1, 2].map((tick) => tick)` — is no
longer read as the owner's in `fresh-object-in-hook-props` and `field-read-before-it-is-declared`. And
`this` inside a `function` written in a callback or a `@compute` is that function's own, not the
component's, so `.map(function () { return this.rate })` is not read as the component's field.
