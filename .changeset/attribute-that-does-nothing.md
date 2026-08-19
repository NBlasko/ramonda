---
"@ramonda/check": minor
---

A new rule: `attribute-that-does-nothing`.

The second net under the JSX types, which now refuse these six names at the call site. A type is a
defence only while nobody casts it away — this catches the `@ts-ignore`, the loosened base class,
and the file with no types at all, where the attribute still renders and still does nothing.

Matched case-insensitively, because the fault does not depend on the capitals: `acceptcharset`
written in full lowercase passes the types through the index signature and is exactly as dead as
`acceptCharset`.

Only host elements are asked. A component's props are its own business, not the document's.
