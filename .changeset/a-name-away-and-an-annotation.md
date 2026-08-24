---
"@ramonda/check": minor
---

`dom-writes` sees a destructured document, and `unserializable-state` reads a type annotation

Two class rules nobody had planted a shape for. One gap each, and both were a spelling one rule
knew and its neighbour did not.

**`dom-writes` was silent on `const { body } = document`.** `body.style.overflow = "hidden"` bottoms
out at an identifier, so the walk found no `document` and said nothing — one class below the dotted
form it reported. The checklist asks for a destructure to be planted whenever a rule matches a
global, and this one had never had one planted. It follows a `const` a few hops now, in this file
only, which is the same bound `late-request-read` takes a local under.

**`unserializable-state` read only the initializer.** A field with none says what it holds in its
type ANNOTATION — read as SYNTAX, `Map<string, T>` being the name `Map` written in the file, never
as a question to the checker. `persist-of-a-lossy-value` read it and this one did not, which is the
same question about the same hydration blob answered two ways. The shape is not exotic:
`@state rows!: Map<string, number>` assigned in `@created` is how a value arriving from a fetch is
written.

The reader moved to `lossyValue.ts` as `lossyFieldValue`, so the two rules cannot drift again. A
field carrying BOTH decorators is still the ungated rule's alone — one line, one report.
