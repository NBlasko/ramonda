---
"@ramonda/router": minor
"create-ramonda": patch
---

ISR pages now live in a store you choose, instead of a `Map` in your server file.

`@ramonda/router/server` gains `createIsrCache`, `memoryStore` and `fileStore`. The cache owns the
timing — fresh, stale-while-revalidate, cold — and the store owns where pages are kept:

```ts
import { createIsrCache, fileStore, routePlan } from "@ramonda/router/server";

const isr = createIsrCache({
  plan: routePlan(server),
  store: fileStore({ dir: "dist/isr" }),
  render: bakePath,
});

// `undefined` means "not an ISR route" — fall through to static or dynamic.
const page = await isr.serve(path);
if (page) sendHtml(res, page.html, page.mode);
```

**Why it needed to change.** A per-process `Map` is correct for one instance and wrong for two:
each caches independently, so a visitor bounces between a copy baked ten seconds ago and one baked
ten minutes ago with no way to tell which they got, and a restart empties it so every ISR route
renders cold again — repeatedly, during a rolling deploy. `fileStore` fixes both for instances that
share a volume; anything else is two methods (`get` / `set`) over Redis, a database, or whatever
your instances do share.

Two things the old inline version did not do:

- **Single-flight.** Ten requests arriving while a stale page rebakes now start one render, not
  ten — the stampede a slow page under load used to produce.
- **A failed background rebake keeps serving the stale page** rather than surfacing as an error. A
  failed *cold* render still throws, because there is nothing else to send.

The scaffolded SSR app uses `fileStore` and clears the cache in its prerender step, since pages
baked by the previous bundle must not be served against a new client bundle.
