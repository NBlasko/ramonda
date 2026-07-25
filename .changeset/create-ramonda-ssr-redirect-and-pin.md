---
"create-ramonda": patch
---

The SSR template now handles server-side redirects, and `@ramonda/*` are pinned so
scaffolds can actually pick up new releases.

- The generated `entry-server` catches `ServerRedirect` and hands `server.mjs` a
  plain `{ redirect }`, which answers with a 302 — so a route guard added to a
  scaffolded SSR app works on the first load, not just after hydration.
- `@ramonda/*` dependencies switch from `^0.0.1` to `~0.0.1`. On a `0.0.z` version
  the caret pins to that exact patch, so scaffolds were frozen at 0.0.1 and could
  never install a newer framework — including the release that adds the redirect API
  the template above uses. The tilde (`>=0.0.1 <0.1.0`) lets a scaffold take the
  latest 0.0.x while the scaffolder still gates the 0.1 / 1.0 line itself.
