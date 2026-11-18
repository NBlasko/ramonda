---
"create-ramonda": patch
---

A server-rendered app's server bundle has `import.meta.env.SSR` true: the build script leaves its defines to
`ramonda()`, which writes them for each build, instead of one `define` shared by the client and the server.
