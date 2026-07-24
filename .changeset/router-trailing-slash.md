---
"@ramonda/router": patch
---

Normalize a trailing slash in the router's pathname, so a route still matches when the host serves it with one — e.g. a static host serving `dir/index.html`, or Cloudflare Pages 308-redirecting `/x` to `/x/`. Without this, a direct load or reload of any non-root route fell through to `*` and rendered a 404.
