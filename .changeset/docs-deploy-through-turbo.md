---
"@ramonda/core": patch
---

The docs deploy built nothing, because it bypassed the task that generates the content.

```
✘ [ERROR] Could not resolve "./generated/content"
✘ [ERROR] Could not resolve "./generated/page-loaders"
✘ [ERROR] Could not resolve "./generated/preloads"
```

`content` was moved out of the docs build script and made a turbo task, to stop two processes rewriting
`src/generated/` while `tsc` read it. `build` picks it up through `dependsOn` — but only when turbo is the
one calling. The Cloudflare workflow ran `pnpm --filter @ramonda/docs build` directly, so nothing ever
generated the directory.

It goes through `turbo run build --filter=@ramonda/docs` now. And because the symptom named the wrong
thing — three missing imports read as a broken repository rather than a skipped step — the docs build
begins with one `existsSync` that says which step to run. Reproduced by deleting `src/generated/` and
watching both the old failure and the new sentence.
