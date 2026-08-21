---
"@ramonda/check": patch
---

Five defects a targeted review found in the two newest files.

- **`dev-guard-as-an-expression` missed the chained and parenthesised `&&`.** `__DEV__ && ready &&
  publish()` parses as `(__DEV__ && ready) && publish()`, so asking whether the immediate left was
  the flag missed every one — while `dev-guard.ts` recognised both. Two answers about one flag, in
  code written hours apart. `guardsDev` is exported now and both read it.
- **A ternary with a real other arm was reported with advice that deletes it.** `__DEV__ ?
  publish("dev") : publish("prod")` came out quoting only the true half, so an author following
  "write it as `if (__DEV__)`" would drop the production one. Only a ternary whose other arm is
  `undefined`, `null` or `void 0` is reported now — the rest is an `if`/`else`, which is not what
  this advice says. The report also rendered a ternary with no `:` arm at all.
- **`window` and `document` accepted by name reported a real binding of that name.** A parameter
  called `window` was read as the browser's. The justification — that requiring them to resolve ties
  the rule to `noLib` — does not hold: `analyze.ts` forces `noLib: true, types: []` whatever the
  project says, so a lib-declared global can never resolve and the only thing that can is a
  declaration in the source.
- **Its mirror: an ambient `declare const self` silenced three rules.** An ordinary line in a worker
  or an SSR entry, and it made `self` resolve, which the old test read as "not the global".

Both directions are one test now: the NAME, unless something in the source declares it for real.
`declare const document` is the author writing down what the platform provides and is still the
platform's; `const self = this` is a name of their own. That is what `dom-writes` was reaching for
when it argued a prefix is not a form a local plausibly shadows — its own fixture declares
`document` ambiently, which is why the by-name rule looked right there.

- **A test asserted nothing.** Three "must stay silent" line numbers pointed at a brace, a blank
  line and a `return (` after the fixture moved under them; only a `toHaveLength` beside them held
  the claim.
