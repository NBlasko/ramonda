---
"@ramonda/core": patch
---

The documentation build now writes `sitemap.xml` and `robots.txt`.

A crawler finds pages by following links, and a documentation site's deepest pages are the ones
fewest links reach — the reference entries somebody arrives at from a search, which is the whole
point of them. The sitemap says they exist without waiting for a path to be walked to them, and
`robots.txt` is where a crawler looks for it: a sitemap nothing points at is a sitemap nothing reads.

Both are generated from the same route list the pages themselves are written from, so a page added
without a sitemap entry is not possible. `BASE` is now exported from `entry-server` rather than
copied into the script — a second copy would mean a move takes the canonical tags with it and leaves
the sitemap pointing at the old host, in the one file nobody opens to check.

`lastmod`, `changefreq` and `priority` are all omitted: the first needs a real date per page and a
wrong one is worse than none, and the other two are hints crawlers have ignored for years. The 404
is absent too — it is a page the host serves, not a page that is.

The build **fails** if `public/` carries either name. It is copied over the output, so a
hand-written `robots.txt` would silently replace the generated one and take the `Sitemap:` line with
it — the build would pass, the file would be there, and it would be the wrong one.
