---
"@ramonda/css": patch
---

The Vite plugin's transform runs before every other one (`order: "pre"`), so a file with style blocks reaches
`@ramonda/build`'s JSX compiler as JavaScript and is compiled like any other, whichever order the two plugins
are listed in.
