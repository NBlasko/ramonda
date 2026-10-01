---
"@ramonda/css": minor
---

On the Vite dev server every block adds one class naming where it was written,
`r:src:src/Card.tsx:10`, so the browser's Elements panel shows which blocks gave an element its
classes. Blocks merged side by side keep all of theirs; a spread leaves no mark. The classes have
no rule and change no style. A build and a test run do not have them. New export:
`withoutSourceMarks`, called by the dev build's code for a spread.
