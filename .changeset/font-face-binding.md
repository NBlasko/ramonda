---
"@ramonda/css": patch
---

**A `@@font-face` binding is the family it declares.** `font-family: $(brand)` compiled to a hash
the `@font-face` rule never declared, so the font silently never loaded. `$(brand)` — and `brand` in
code — is now the family exactly as written, `"Brand"`: a reference, so a typo is an error and a
rename is one edit. Two faces of one family (two weights) are still two rules.
