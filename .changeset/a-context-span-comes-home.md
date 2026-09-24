---
"@ramonda/css": patch
---

**A highlight's `contextSpan` stayed in the virtual file.** In a file holding a style block,
`getDocumentHighlights` brought the name home and left the statement around it pointing into the
copy the checker reads.

Measured on a file of 103 characters:

| | `textSpan` | `contextSpan` |
|---|---|---|
| at offset 6 | `6+1` | `948+12` |
| at offset 19 | `19+1` | `961+64` |

Nine hundred characters past the end of the file, inside the preamble the virtual copy carries. An
editor uses that span for the context it shows beside a reference and around a rename, so it was
reading a range that is not there.

It was one member of a family that forgot: `elsewhere` and `findReferences` map both spans, and this
one mapped the first.

Found by asking the question the plugin's own note raises — *a span that is too long DELETES CODE* —
of every span-returning proxy at every offset in four shapes of file, which is now a test.
