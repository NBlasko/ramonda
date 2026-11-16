---
title: Routes by feature
description: Keep each feature's routes beside its pages, and put the app's table together from them — loaded when visited, checked the same.
section: Routing
order: 77
---

# Routes by feature

As an app grows, its pages stop fitting in one file's head. Keep each feature — tournaments, players,
settings — in a folder of its own, with its routes beside its pages, and let the app put its table
together from those parts. Every link is still checked against every route.

## A feature owns its routes

A feature writes its table where its pages are, with the full paths:

```tsx module:./playerRoutes
// src/playerRoutes.tsx
import { createRoutes } from "@ramonda/router";

export const playerRoutes = createRoutes({
  "/players": <Team />,
  "/players/:id": <Player />,
});
```

The app's table takes the parts it is made of, then its own routes, in the order they are matched,
and is registered once, as any table is:

```tsx
// src/routes.tsx
import { createRoutes } from "@ramonda/router";
import { playerRoutes } from "./playerRoutes";

export const routes = createRoutes(playerRoutes, {
  "/": <Profile />,
  "*": <Profile />,
});

declare module "@ramonda/router" {
  interface Routes {
    app: typeof routes;
  }
}
```

`<Link href="/players/7">` in any feature is checked against that one registration. A spread —
`createRoutes({ ...playerRoutes })` — does not work: the table a feature exports is already compiled,
and the compiler refuses it.

`createRoutes` refuses, when the table is built, a path two parts both name, a second `"*"`, and a
route an earlier one hides — `"/players/new"` after `"/players/:id"` could never be reached.

## One address per page

The paths in a feature's table are whole: the feature owns `/players/…`, and a reader finds a page's
address by searching for it. A feature is not mounted under a prefix the app picks, and the same
feature is not mounted twice — the links inside it could then not be written down, and nothing could
check them.

Reuse a feature's PAGES instead, under an address each:

```tsx
import { createRoutes } from "@ramonda/router";

declare class PostList extends Component<{ source: "blog" | "news" }> {}
declare class Post extends Component<{ source: "blog" | "news" }> {}

export const postRoutes = createRoutes({
  "/blog": <PostList source="blog" />,
  "/blog/:slug": <Post source="blog" />,
  "/news": <PostList source="news" />,
  "/news/:slug": <Post source="news" />,
});
```

What differs between the two — the data, a title, who may see it — arrives by props or a
[context](/composition/context). A language or a tenant in the address needs none of this:
`/:lang/players` and `/org/:orgId/players` are paths with a param.

## Load a feature when it is visited

A feature's pages need not be in the first download. A view in the table can be an
[`AsyncLoad`](/composition/lazy), and the feature's code is then fetched the first time one of its
routes is opened:

```tsx module:./TeamList
// src/TeamList.tsx
import { Component } from "@ramonda/core";

export class TeamList extends Component {
  render() {
    return <p>teams</p>;
  }
}
```

```tsx
// src/teamRoutes.tsx
import { AsyncLoad } from "@ramonda/core";
import { createRoutes } from "@ramonda/router";

const loadTeamList = () => import("./TeamList");

export const teamRoutes = createRoutes({
  "/teams": <AsyncLoad lazy={loadTeamList} namedExport="TeamList" onLoading={<p>…</p>} errorFallback={<p>!</p>} />,
});
```

`ramonda-check --split` lists what loads first and what each lazy view brings, so a feature that
slipped into the first download shows there.

## A feature that exists only under a condition

A part may be `undefined`, which adds nothing — so a feature can be in some builds and not others:

```tsx
import { createRoutes } from "@ramonda/router";

declare const debugRoutes: ReturnType<typeof createRoutes>;

export const routes = createRoutes(import.meta.env.DEV ? debugRoutes : undefined, {
  "/": <Profile />,
});
```

The type has the debug routes in every build — the compiler reads one program, where the condition is
a `boolean`. So [`ramonda-check`](/reference/check) holds the line instead: a `<Link>`, a `push` or a
`route()` naming one of them is an error (`link-to-a-conditional-route`) unless it is written under
the same condition — `{import.meta.env.DEV && <Link href="/debug" />}`, an `if`, a `const` holding the
condition — or sits in one of those debug pages. The same goes for the app's own conditions,
`features.admin ? adminRoutes : undefined`.

## How each page renders on the server

A feature's server modes sit beside it too, spread into the app's config — see
[a table from parts keeps its modes beside it](/ssr/modes#a-table-from-parts-keeps-its-modes-beside-it).

## When a feature becomes a package

Lifted out of the app, a feature registers its own routes, under a name of its own, in its
`routes.tsx`:

```tsx
import { createRoutes } from "@ramonda/router";

export const leagueRoutes = createRoutes({ "/leagues": <Team /> });

declare module "@ramonda/router" {
  interface Routes {
    leagues: typeof leagueRoutes;
  }
}
```

Built on its own, its links are then checked against its own routes, and a link to another feature's
route is refused until it imports that feature's routes. In the app the two registrations merge.
`@ramonda/router` and `@ramonda/core` are its peer dependencies — with a copy of its own, its routes
and its contexts would land on a second router the app never mounts.

## Next

- [Routing](/routing) — the table, the outlet and the registration this page builds on.
- [Lazy loading](/composition/lazy) — `AsyncLoad`, and what a failed load shows.
