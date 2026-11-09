---
"create-ramonda": patch
---

A new SSR project minifies its client bundle and writes a source map beside it. Unminified, the bundle was a fifth bigger on the wire even compressed; the map keeps a production stack trace pointing at the project's own files.
