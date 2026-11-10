---
"@ramonda/router": minor
---

Hydration renders the route the server rendered, and the router reads the browser's URL right after, as an ordinary update. It used to read it before the hydration render, so a component showing a hash key — on every page, since the hash never reaches a server — or the query on a baked page rendered something the server had not, and hydration reported `RMD007`. The page still ends at the browser's URL before the first paint.

One change to watch: a `@created` below the router runs before that read, so while hydrating it sees the server's URL. Read the hash or the query in `@mounted` or `render`.
