---
title: Params, query and hash
description: Read the current URL inside a component — path params, the query string, the hash.
section: Routing
order: 72
---

# Reading the URL

To read the current URL inside a component — the `id` in `/players/9`, a `?query`, a
`#hash` — use `Navigator`:

```tsx
import { createRoutes, Navigator } from "@ramonda/router";

// routes.ts — the table, registered once (see /routing)
const routes = createRoutes({ "/players/:id": <Profile />, "/teams/:teamId": <Team /> });
declare module "@ramonda/router" {
  interface Register {
    routes: typeof routes;
  }
}

export class Player extends Component {
  route = this.use(Navigator);

  render() {
    const { id } = this.route.params("/players/:id");
    return <article>Player {id}</article>;
  }
}
```

The table is in the example on purpose: the pattern you name is **checked against it**, so the two
cannot drift. In a real app the kit is minted once and imported — `import { Navigator } from "./routes"`
— and the check comes with it.

**Name the pattern and the type comes out of it.** `id` is a `string` with nothing annotated, and the
pattern is checked against the table your kit was built from — a route that table does not declare is
a type error, and so is a static path, because it has no params to read. That is the same machinery
`route("/players/:id", { id })` has always used for building an href, pointed the other way.

What it gives you:

| | |
|---|---|
| `pathname` | `/players/9` |
| `params(pattern)` | the `:params` of that pattern, typed from it |
| `params<T>()` | the same values, typed by what you assert — the untyped door |
| `searchParams` | `?a=1&b=2` → `{ a: "1", b: "2" }` |
| `hashParams` | `#a=1&b=2` → `{ a: "1", b: "2" }`, read as the query is. A bare `#install` is `{ install: "" }` — the name of a section. With [levels](#a-hash-in-levels), the keys on this component's own line |

## You react to the part you read

`pathname`, `searchParams` and `hashParams` are tracked separately: a component reading only
`pathname` doesn't re-render when a query parameter or the hash changes, and one reading
`hashParams` re-renders on a hash change while the rest of the page stays as it is. You get
that for free — and it's why a plain `<Link>` (which reads none of it) doesn't
re-render on every navigation.

## The pattern is checked, not trusted

A named pattern is a claim about which route the component is standing on, and a claim nothing
verifies is worth nothing: if the outlet above matched a route with no `:id`, `params("/players/:id").id`
would be `undefined` where the type says `string`, and it would travel. So every `:name` in the pattern
has to be present in what the outlet matched, and it **throws** otherwise — naming both the pattern you
asked for and the route you are actually on. It is the mirror of `route("/u/:id", {})`, which has always
refused to build `/u/undefined`.

It is **not** an equality check on the route key. A component rendered by both `/players/:id` and
`/users/:id` names one of them and is correct on both, because what it asked for is satisfied on both —
the claim is about the params, not the spelling. When two routes genuinely disagree about their params,
that is what `params<T>()` is for.

**Does naming the route make the component less reusable?** It names a coupling that was already there:
`params<{ id: string }>()` needs a route supplying `id` just as much, and that is now said out loud too
— see below. And a component that is genuinely reusable should not be reading the URL at all — have the
page read the param and pass it down, `<UserAvatar userId={id} />`, for the same reason a value one child
needs is a prop rather than a context. If a component reads `params()`, it *is* part of a route; the
pattern only writes that down.

## `params` needs an outlet

`params()` comes from the `<RouteOutlet>` that matched, so it only means something
inside the routed page. A nav bar beside the outlet has `pathname` but no params —
which is right, it isn't part of any route.

Reading `pathname` there is correct, and reading `params(pattern)` there throws. `ramonda-check`
says it first, and it says the other half too — naming a route that is not the one you are on:

```
[ramonda-check] 2 params(pattern) read(s) the routing cannot answer:

  src/App.tsx:264:29
    <Layout> reads `route.params("/users/:id")`, and no arrangement in this build
    puts it under a <RouteOutlet>.

  src/UserPanel.tsx:12:19
    <UserPanel> reads `nav.params("/guide/:slug")`, but the route that mounts it
    is "/users/:id", which supplies no `:slug`.
```

The second one is the case nothing else can reach. `<UserPanel>` is a child of a routed page, so it
*is* under an outlet — the fault is that the outlet above it matched a different route. The checker
knows because it carries the table's **key** down with the view, and the key is the only place a
route's params are written.

A component under two routes that both supply what it asked for is silent: `/users/:id` and
`/people/:id` both give `:id`, and the claim is about the params, not the spelling. But **one
arrangement that fails is enough** — a component rendered inside a routed page *and* beside the
outlet is reported, because the second place has no matched route and the read throws there.

The types cannot answer either of these. `params("/users/:id")` is checked against the paths your
**table** declares, never against the route the component is standing on.

## `params()` is judged by the keys it names

The argument-less door claims a route too, the moment it names a key. `params<{ teamId: string }>()`
says `teamId` is always there; so does `const { teamId } = params()`, and so does `params().teamId`.
Under a route that supplies no `:teamId`, all three read `undefined` where the type says `string` —
and unlike the pattern door, **this one does not throw**. Nothing tells you at all:

```
[ramonda-check] 1 params() read(s) claiming a key the routing does not supply:

  src/TeamHeader.tsx:14:19
    App > RouteOutlet > TeamPage > TeamHeader
    <TeamHeader> reads `nav.params()` for `userId`, but the route that mounts it is
    "/teams/:teamId", which supplies no `userId`. The read gives `undefined` where the
    type says `string`, without throwing. Name the pattern instead, or mark the key
    optional if this component really is rendered by routes that disagree.
```

Say it may be absent and nothing is reported, because nothing was claimed:

```tsx
import { Component } from "@ramonda/core";
import { Navigator } from "@ramonda/router";

// The table registered above: `/players/:id` and `/teams/:teamId`.

// Rendered by both, and they disagree about their params — the case params<T>() is for.
export class OwnerChip extends Component {
  route = this.use(Navigator);

  render() {
    const p = this.route.params<{ id?: string; teamId?: string }>();
    return <b>{p.id ?? p.teamId}</b>;
  }
}
```

A default does the same job — `const { teamId = "" } = params()` — and so does reading off a variable
one line later, which stays unjudged on purpose. Asking *whether* a key is there is not claiming that
it is, so `params().hasOwnProperty("teamId")` is fine. Two things are deliberately not answered: a
type argument that is a **name** rather than a written-out shape, and a key built from an expression.

**What it cannot see.** A route table whose keys are computed — `table[page.path] = …` in a loop —
names its paths at runtime, so the checker knows the views are routed but not under what; it reports
neither. A pattern in a `let`, or one built by concatenation, is the same. And a navigator handed
over as a prop rather than taken with `this.use(Navigator)` is not recognised. A pattern or a table
key held in a `const` **is** followed, so extracting your routes into constants costs you nothing.

## Params are always strings

They come out of a URL, so they are strings. Parse them where you use them, and treat
a missing or malformed one as a real possibility — a URL is user input.

## Keep UI state in the URL

A tab, a filter, a search query — anything you'd reach for `@state` to hold can instead
live in the URL. Then it survives a reload, it's shareable as a link, and Back undoes
it, all for free. Read it with `searchParams`, and change it with `updateSearchParams`:

```tsx
import { Navigator } from "@ramonda/router";

export class Filters extends Component {
  route = this.use(Navigator);

  setColor(color: string) {
    this.route.updateSearchParams((prev) => ({ ...prev, color }));
  }
  setSize(size: string) {
    this.route.updateSearchParams((prev) => ({ ...prev, size }));
  }
}
```

Three things make this the right tool for fast-changing state like a filter panel:

- **It touches only the query.** `pathname` doesn't change, so the route never
  re-matches — no page swap, cheap on every keystroke. (Routes match on the path only;
  the query is never part of a route pattern.)
- **It stays put.** No scroll to the top, so filtering a long table doesn't yank you
  away from it. Pass `{ scroll: true }` on the rare time you want the jump.
- **It's race-free.** Give it a function and it receives the *freshest* params, so two
  filters changed in the same instant don't clobber each other — the second reads the
  first's write. This is why the functional form matters: `setColor` and `setSize`
  firing together both land, instead of one silently dropping the other.

Pass a plain object instead of a function to replace the query outright. And by default
each change is a new history entry, so Back steps through them; pass `{ replace: true }`
(e.g. while someone is typing) to avoid filling the history.

The same `updateHashParams` exists for the hash, with the same options and the same two forms. A
key with an empty value is written bare — `{ install: "" }` is `#install` — which is how a link names
a section.

## A hash in levels

Some UI state belongs to other UI state. A video page keeps its open tab in the hash, `#tab=comments`.
Put that page inside a workspace whose own navbar switches between `video` and `analytics`, and the
tab means nothing once the workspace shows analytics. It should go.

The page cannot know who its parent is. The parent knows its child, so it says so where it puts it:

```tsx
import { Component } from "@ramonda/core";
import { HashLevel } from "@ramonda/router";
import { Navigator } from "@ramonda/router";

class VideoPage extends Component {
  route = this.use(Navigator);

  open(tab: string) {
    this.route.updateHashParams((prev) => ({ ...prev, tab }));
  }

  render() {
    return <p>{this.route.hashParams.tab ?? "comments"}</p>;
  }
}

export class Workspace extends Component {
  route = this.use(Navigator);

  show(nav: string) {
    this.route.updateHashParams((prev) => ({ ...prev, nav }));
  }

  render() {
    return (
      <main>
        {this.route.hashParams.nav === "video" && (
          <HashLevel of="nav">
            <VideoPage />
          </HashLevel>
        )}
      </main>
    );
  }
}
```

Everything the video page writes now belongs to the workspace's `nav` key:
`#nav=video#nav:tab=comments`. When `show("analytics")` runs, what `nav` owns is cleared, and the URL
is `#nav=analytics`.

- **The page does not know its parent.** On its own it writes `#tab=comments`. It belongs to `nav`
  only because the workspace put it inside `<HashLevel of="nav">`, so a refactor inside the page
  cannot move it.
- **A key clears only what it owns.** Put a filter panel beside it in `<HashLevel of="panel">`, and
  switching `nav` leaves the panel's keys alone.
- **Only a change clears.** Writing the value a key already has keeps what it owns. A key that was not
  in the URL and now is counts as a change, even when the value is the one the page showed by
  default: the router sees the URL, not the default.
- **An updater gets its own keys.** `prev` in the video page holds `tab`, not `nav`, so spreading it
  does not copy the parent's key down. Spread `prev`, not `hashParams`: `hashParams` holds the
  parent's keys too, and spreading it writes them into this page's own part of the hash.
- **A component reads its own line.** `hashParams` holds the top's keys and every owner's down to its
  own, so the video page reads `nav` too. A key it writes itself wins over its parent's, for it alone:
  the workspace still reads its own `nav`. A sibling's keys are not in it, so the filter panel and the
  video page may both use `tab`.
- **The owners are in the URL.** Each `#` segment after the first names its owner before a `:`, and
  `&` separates its keys. A reload, a shared link and Back keep who owns what. Nothing depends on what
  is mounted.
- **It nests.** A `<HashLevel of="tab">` inside the video page puts its child under `nav.tab`, and
  switching `nav` clears that too.

## Next

- [Navigating](/routing/navigating) — push, replace, back, forward.
