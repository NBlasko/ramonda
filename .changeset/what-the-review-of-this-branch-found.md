---
"@ramonda/check": patch
---

What the review of this branch found — four defects, three of them the same shape: a spelling the
audit had already handled, planted again in its other form.

**A subclass OVERRIDING a base's method had both bodies walked**, so a clock read in the version that
never runs was reported. Pre-existing, and widened by this branch's `super.` support. The lookup
takes the NEAREST declaration now, which is how JS resolves a method — and `super.` starts at the
BASES, which is the whole meaning of the keyword.

**A static was matched by NAME**, so a class whose name happened to equal the component's would have
been walked as if it were the component. It is resolved now: this package does not guess about which
declaration it is looking at.

**A `@Host` props callback with a BLOCK body** — `() => { return { id: "x" } }` — was not read, so the
id it writes was missing from the table and the link to it was reported as going nowhere. The
concise body had been fixed; this is the same fault in its other spelling.

**A `#private` member cost every rule something, and all of it silent.** The shared `memberName`
treated `#field` as unnameable — true of a computed name, and not of this one — so
`server-env-in-shared-code` reported one as `(anonymous)` and could not excuse it, the render walk
never followed `this.#helper()`, and `stale-field` could not see one go stale. A `#` member also
carries no `private` MODIFIER, which is what the new excuse read, so the `#` spelling of an excused
helper was reported while the `private` one was not. Both fixed: `#name` is a name, and `#` is
privacy the stronger way — a cast walks straight through `private` and cannot touch a `#`.
