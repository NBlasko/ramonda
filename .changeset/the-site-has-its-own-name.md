---
"@ramonda/core": patch
"@ramonda/check": patch
"@ramonda/router": patch
"@ramonda/query": patch
"@ramonda/form": patch
"@ramonda/lens": patch
"@ramonda/build": patch
"@ramonda/server": patch
"@ramonda/devtools": patch
"@ramonda/testing-library": patch
"create-ramonda": patch
---

The documentation is at **ramonda.dev**, and everything that names it says so.

The site was reachable only at its Cloudflare Pages subdomain, `ramonda.pages.dev`, and that address was
written into 63 places. The custom domain is attached now, so all of them name it: `homepage` in every
published `package.json`, every README, the URL a diagnostic tells you to open, the scaffolder's closing
line, both `create-ramonda` templates, and `BASE` in `apps/docs/src/entry-server.tsx`.

**`BASE` is the one that mattered beyond tidiness.** Every `canonical`, `og:url`, `og:image` and the
whole of `sitemap.xml` and `robots.txt` are built from it — its own docblock warned that a move would
take the canonical tags and leave the sitemap behind. Left alone, every page on the new domain would
have told a search engine that the real page is on `pages.dev`. Verified on a real build rather than
assumed: `Sitemap: https://ramonda.dev/sitemap.xml`, `<loc>https://ramonda.dev/…`, and the canonical
and `og:image` tags on the built pages.

**Two places deliberately keep the old host.** The CHANGELOGs: those are published release notes, the
links were correct when they were written, `pages.dev` still resolves, and rewriting them would be
rewriting history. And `.github/workflows/README.md`, where `ramonda.pages.dev` is a FACT about
Cloudflare — the project's name is its subdomain — so the sentence stays and gains the one that was
missing: the site is served at the custom domain, and leaving anything on `pages.dev` is how a search
engine is told the real page is elsewhere.
