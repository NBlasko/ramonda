---
title: Matching and URLs
description: The primitives under the router — parse a URL, build one back, match a pathname against a pattern, and refuse an href that is not a destination.
section: Routing
order: 76
---

# Matching and URLs

[`createRouter`](/routing) hands you a `Router`, a `RouteOutlet`, a `Link` and a `Navigator`, all
typed against your route table, and an app that uses those never needs this page.

These are what those are built on, exported because a few jobs sit outside the router and need the
same answers: a server deciding which route a request is, a script checking that every link in your
content goes somewhere, a test asserting that a pattern extracts what you think it does.

Everything here is a plain function. None of them touches the router's state, and none of them
renders anything.

## `parseUrl()`

The URL the browser is on, as a `RouterState` — the pathname, the query as an object, and the hash
tags. This is what the router reads when it starts and on every back and forward.

```ts
// at https://example.com/players/8?tab=stats#open
parseUrl();
// { baseUrl: "/players/8", queryParams: { tab: "stats" }, hashTags: [{ key: "open", value: "", level: 0 }] }
```

**A trailing slash is removed**, so `/players/8/` and `/players/8` are one route. That is not
tidiness: a static host that serves `dir/index.html` will redirect `/x` to `/x/`, and without this
every direct load of such a URL would match no route and fall through to `*`.

**It reads `window.location`, so it is browser-only.** On the server the request's URL is what you
have — see [the router on the server](/routing/server).

## `parseUrlString(url)`

The same, for a URL you hand it rather than the one you are on. A relative URL resolves against the
current page, which is what makes `href="../settings"` work.

```ts
parseUrlString("/players/8?tab=stats");
```

Also browser-only, and for the same reason: resolving a relative URL needs a URL to resolve it
against.

## `buildUrl(state)`

The inverse of `parseUrl` — a `RouterState` back into a string.

```ts
buildUrl({ baseUrl: "/players/8", queryParams: { tab: "stats" }, hashTags: [] });
// "/players/8?tab=stats"
```

Keys and values are percent-encoded, and hash tags are written in `level` order rather than in the
order the object happened to hold them — so the same state always produces the same string, which is
what lets two URLs be compared.

The result goes through `sanitizeHref`, below.

## `sanitizeHref(href)`

Answers whether a string is somewhere you can navigate, and returns `"/"` when it is not.

```ts
sanitizeHref("/settings");             // "/settings"
sanitizeHref("https://example.com");   // "https://example.com"
sanitizeHref("javascript:alert(1)");   // "/"
sanitizeHref("//evil.com");            // "/"
```

**What it allows** is a path starting with a single `/`, and an `http://` or `https://` URL.
Everything else becomes `"/"`: `javascript:`, `data:` and `vbscript:` are the ones that matter, and
a protocol-relative `//host` is refused too — it looks like a path and is a different site.

**It replaces rather than throws**, which is a deliberate trade. An href built from data comes from
wherever that data came from, and a page that renders a broken link is a better outcome than a page
that does not render. The cost is that a mistake is silent: if a link goes to the home page for no
apparent reason, this is the first thing to check.

## `matchParams(pathname, pattern)`

The `:param` values in a pathname, or `null` if the pattern does not match it.

```ts
import { matchParams } from "@ramonda/router";

matchParams("/players/8", "/players/:id");   // { id: "8" }
matchParams("/teams/8", "/players/:id");     // null
```

**It compiles a regular expression on every call.** That is fine for a test or a one-off and wrong
for anything that runs per render — use `createRoutes` and `matchCompiled` below, which compile
once.

## `matchRoute(pathname, keys)`

The first key in a list that matches, with its params. Falls back to `"*"`, matching nothing.

```ts
import { matchRoute } from "@ramonda/router";

matchRoute("/players/8", ["/", "/players/:id"]);
// { key: "/players/:id", params: { id: "8" } }
```

Order matters: the first match wins, so a broader pattern written before a narrower one takes both.

## `matchCompiled(pathname, routes)`

The same question asked of a compiled route table, with no regular expression built at call time.
This is what the outlet uses on every navigation.

```tsx
import { createRoutes, matchCompiled } from "@ramonda/router";

const table = createRoutes({ "/": <Profile />, "/players/:id": <Player /> });

matchCompiled("/players/8", table);
// { vnode: <Player />, params: { id: "8" }, key: "/players/:id" }
```

It returns the table's `*` fallback and empty params when nothing matches, so there is no null to
handle — a pathname always has an answer.

## Next

- [Params, query and hash](/routing/params) — reading these values inside a routed page, where the
  router has already done the matching for you.
- [The router on the server](/routing/server) — where a request's URL replaces `window.location`.
