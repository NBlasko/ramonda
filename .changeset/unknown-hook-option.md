---
"@ramonda/check": minor
---

`unknown-hook-option`, an error: a hook's props callback names an option the hook does not take — `this.use(Head, () => ({ robots: "noindex" }))`, `Query({ staleTimee })`. The type check lets it through, because the hook's props type is inferred from the bag, and the hook ignores it. What the hook takes is read off its type, so it covers every hook — the project's own, an installed package's, a context Provider — and the report names the option that was probably meant, or lists the ones it takes.
