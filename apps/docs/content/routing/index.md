---
title: Routing
description: Show the right page for the URL and switch between pages without a reload — a route table, a Router that tracks the URL, and an outlet that shows the match.
section: Routing
order: 70
---

# Routing

Most apps are more than one page — a home screen, a profile, a settings panel.
**Routing** is showing the right one for the current URL and switching between them
without a full page reload.

You write a **route table** with `createRoutes` and register it once. Everything else comes from
the package: **`Router`** (tracks the URL), **`RouteOutlet`** (shows the matching page), **`Link`**
and **`Navigator`** (below), and **`route`** (for `:param` links) — and the registration is what
binds the last three to your table.

```tsx
import { Component } from "@ramonda/core";
import { createRoutes, Router, RouteOutlet } from "@ramonda/router";

export const routes = createRoutes({
  "/": <Home />,
  "/players/:id": <Player />,
  "*": <NotFound />,
});

declare module "@ramonda/router" {
  interface Routes {
    app: typeof routes;
  }
}

export class App extends Component {
  router = this.use(Router);

  render() {
    return (
      <div className="app">
        <NavBar />
        <RouteOutlet routes={routes} />
      </div>
    );
  }
}
```

Put the table and its registration in one module — `routes.ts` in the examples that follow. Your
pages import `Link`, `Navigator` and `route` from `@ramonda/router`, never from `routes.ts`, so
the module holding the table (which imports every page) is not imported back by them. Only the
component that places the outlet imports `routes`.

**Register the table once, under `app`.** Forget it and the first `<Link href>` fails to compile, with the line to
write in the message. Two apps in one TypeScript program would share the registration, so give
each app its own `tsconfig.json`.

```demo:RouteInfo
```

(That demo reads the router of *this* site — these docs are a Ramonda app, so the
values are real.)

## What you get

- **Links checked against your routes** — a `Link` to a path your table does not have is a type
  error, and so is a `:param` left out. [Below](#links-are-type-checked-against-your-routes).
- **Params, query and hash** — read inside any component through `Navigator`, a param by the
  pattern it belongs to. See [params, query and hash](/routing/params).
- **Outlets inside outlets**, for a layout that stays while its page changes — see
  [nested outlets](/routing/nested).
- **The same routes on the server**, so a page renders there before it reaches the browser — see
  [the router on the server](/routing/server).

## Install

The router is a separate package, beside `@ramonda/core`:

```install
@ramonda/router
```

## The routes table

`createRoutes` maps each URL pattern to what to show:

- `"/"` — the home page.
- `"/players/:id"` — a pattern; `:id` matches any value, and the page can read it (see
  [params](/routing/params)).
- `"*"` — the fallback for when nothing else matches (a "not found" page).

Call it **once**, at the top of a module — not inside `render()` — so the patterns
are compiled a single time.

### A table from parts

A table can also be put together from other tables — a feature's routes, kept beside its pages, and
the app's own:

```tsx
import { createRoutes } from "@ramonda/router";

const playerRoutes = createRoutes({
  "/players": <Home />,
  "/players/:id": <Player />,
});

export const routes = createRoutes(playerRoutes, {
  "/": <Home />,
  "*": <NotFound />,
});
```

The parts are matched in the order they are given. A part may be `undefined`, which adds nothing —
what `import.meta.env.DEV ? debugRoutes : undefined` leaves in a production build. A spread does not
work here: a table `createRoutes` made is already compiled, so `{ ...playerRoutes }` would copy its
insides rather than its paths, and the compiler refuses it.

Refused when the table is built, so the first dev server start stops on it:

- a path two parts both name;
- a second `"*"`;
- a route an earlier pattern matches first — `"/players/new"` after `"/players/:id"` can never be
  reached. Put the fixed path first.

## `Router` is a hook; `RouteOutlet` is where the page goes

You add `Router` with `this.use(Router)` on your top component: it tracks the URL and
adds no element of its own. `RouteOutlet` is the component you place where the routed
page should appear.

Keeping the two separate is what lets a nav bar sit *beside* the outlet and stay put
as you move around — only the outlet's content swaps, everything around it keeps its
state:

```tsx
<div>
  <NavBar />                        {/* stays as you navigate */}
  <RouteOutlet routes={routes} />   {/* this is what changes */}
</div>
```

## Links are type-checked against your routes

Because your table is registered, `<Link href>` only accepts a real path — change or
rename a route and every stale link becomes a **compile error**, not a broken link you find by
clicking:

```tsx expect-error
import { Link, route } from "@ramonda/router";

<Link href="/">Home</Link>                          // ✓
<Link href="/nope">Home</Link>                       // ✗ not a route
<Link href={route("/players/:id", { id: "9" })}>…</Link>  // ✓ params typed; a missing/misspelled param errors
```

A static path goes in directly; a `:param` path must be built with `route(...)`, which fills the
params and rejects a wrong one. The same paths type `Navigator.push` / `replace`. More in
[links](/routing/links).

## The types, and a component in a package

Every name below exists so that the registered table's paths reach a type annotation.

| | |
|---|---|
| `Routes` | the interface your app registers its table in, under `app` — once |
| `Href` | every href the registered table accepts: a path, filled in, with a query or a fragment |
| `BuiltHref` | what `route(...)` returns — a `:param` path it has filled and checked |
| `RouteConfig` | what `createRoutes` returns — the compiled table, carrying its literal path keys |
| `PathOf<C>` | the navigable paths of a config: every declared key except the `"*"` fallback |
| `TypedLinkProps` | `Link`'s props, with `href` an `Href` |
| `TypedNavigator` | the `Navigator` hook's type, with `push` and `replace` taking an `Href` |
| `RouteParams` | the `:param` values a matched route supplies, as a record of strings |
| `RouteOutletProps` | `RouteOutlet`'s props |

**`Href` is how a component published in a package takes a link.** The package cannot know the
app's paths, so it does not write one; it takes one as a prop, typed `Href`, and the app's own
registered table checks what the app passes:

```tsx
import { Component } from "@ramonda/core";
import { type Href, Link } from "@ramonda/router";

export class UserCard extends Component<{ name: string; href: Href }> {
  render() {
    return <Link href={this.props.href}>{this.props.name}</Link>;
  }
}
```

**`RouteConfig` carries its paths in a phantom field.** Nothing at runtime holds them: they exist
only so `createRoutes({ "/": …, "/u/:id": … })` remembers the literal union `"/" | "/u/:id"`, and the
registration can type a `Link` against it. The field defaults to `string`, which is what lets a
function taking a plain `RouteConfig` still accept a narrower one.

`RouterNavigator` is the untyped shape underneath `TypedNavigator` — the methods themselves, before
the paths are narrowed. You would name it only when writing something that takes any router's
navigator rather than this one's.

## One Router per app

Mounting a second `Router` while one is live throws — there is a single source of
truth for the URL, and two would disagree. (Unmounting one and mounting another is
fine, so tests and hot reload work.)

## Why route through it at all

You could set `window.location` yourself. What the router buys you is that **every
change to the URL goes through one channel**, and each one starts from the freshest
state — even the imperative `push` and a `<Link>` click share it. So two navigations
that land in the same tick serialize instead of clobbering each other: no lost update
where one write reads stale state and overwrites the other. URL bugs that only show up
under fast clicks or async races simply don't have a place to happen.

The other half is that **the URL is a place to keep state**. A selected tab, an open
filter, a search query — put it in the URL and it survives a reload, it's shareable as
a link, and Back undoes it. See [keeping state in the URL](/routing/params#keep-ui-state-in-the-url).

## Next

- [Links](/routing/links) — moving around without breaking what a real link does.
