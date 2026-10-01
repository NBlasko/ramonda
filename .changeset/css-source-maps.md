---
"@ramonda/css": minor
---

On the Vite dev server, a file's stylesheet comes with a source map: a browser's style panel names
the `.tsx` line beside each rule, and clicking it opens the declaration. A longhand split out of a
shorthand points at the shorthand. The plugin turns on Vite's `css.devSourcemap` unless the project
sets it; a production build is unchanged.
