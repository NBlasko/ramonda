---
"@ramonda/css": minor
---

`override-out-of-order` follows a spread and a `mergeClassNames` call across blocks and files. A declaration written to override one that a spread brought under a stronger condition — `...$(card); border-top-color: blue;` where `card` has `@media print { border: none; }` — will not win where both apply, because the stylesheet emits the stronger condition last. It used to be only a development warning, printed during a build with no file, no line and the property's short form (`bc`); `ramonda-css` and the editor now report it at the declaration, and it fails the check like every other rule. The development warning stays for what the check cannot follow — a block that arrives as a prop or is chosen at run time — and names the property as written.
