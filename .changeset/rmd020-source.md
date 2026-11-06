---
"@ramonda/core": minor
---

RMD020 says where the element was written: `Written at src/Toolbar.tsx:41:9`, beside the path through the output it already named, and as `file`, `line` and `column` on the diagnostic record. The development JSX runtime keeps the place the compiler hands it with every tag; the production runtime is unchanged.
