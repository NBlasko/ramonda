---
"@ramonda/css": minor
---

**A style block written as a bare JSX attribute is refused.** `css=@@( … )` no longer compiles; write
`css={@@( … )}`, or give the block a name — `const panel = @@( … )` — and pass that. Both were always
supported, both compile to the same class, and nothing else changes.

A block is a **TypeScript value**, and a bare attribute is the one spelling that is not one:
supporting it meant this package extended JSX rather than TypeScript. It also could not be made to
work properly. An editor stops consulting syntax injections the moment it enters a tag's attribute
list, so the spelling was coloured only as the first attribute on the tag's own line and read as an
error everywhere else; and Prettier never offers a plugin the chance to print an attribute value, so
the formatter handed back the braced form regardless — the file you saved was not the file you wrote.

The refusal is `block-as-a-jsx-attribute`, on the attribute name, in the build and in the editor. It
names the spelling to write. The rule ran as `uncolourable-block` before this, a suggestion the build
ignored, which was right while the spelling worked.

The documentation moved with it. `/style-blocks` is seven pages now instead of one of 1468 lines, and
it has an install section, which it did not before.
