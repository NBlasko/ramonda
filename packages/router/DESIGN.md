# Proposal: one registered route table

Status: **built** (approved 2026-11-10, with both recommendations below). The phase-2 checker rule is not.

## The problem

Typed links come from a kit today. An app writes `createRouter(routes)` and imports `Link`, `Navigator` and
`route` from the module that holds the table.

- **The modules form a cycle.** That module imports every page, because the table holds `<Home />`, and every page
  imports the kit back. It works in tests. In a real build it depends on the order the modules load in.
- **The types form a cycle too.** A page's type reads the kit, the kit reads the table, and the table reads the pages.
- **A package cannot have a typed link.** A component published on npm has no way to reach the app's table.

## The proposal

The app writes its table once and **registers** it:

```tsx
// routes.tsx
import { createRoutes } from "@ramonda/router";

export const routes = createRoutes({
  "/": <Home />,
  "/users/:id": <User />,
  "*": <NotFound />,
});

declare module "@ramonda/router" {
  interface Register {
    routes: typeof routes;
  }
}
```

Everything else is imported from the package, never from `routes.tsx`:

```tsx
// pages/Home.tsx
import { Component } from "@ramonda/core";
import { Link, Navigator, route } from "@ramonda/router";
```

- The types do not change:
  - `Link href`, `Navigator.push` and `replace`, `route()` and `params(pattern)` are checked against the
    registered table, exactly as against a kit today;
  - nothing on the page is written twice.
- **No module cycle.** A page imports `@ramonda/router`. Only the components that mount the table import
  `routes.tsx`: the app root (`<RouteOutlet routes={routes} />`) and the server config (`defineServer(routes, …)`).
- **Nested outlets need nothing new.** The outer table already names every path a page renders on (see
  `/routing/nested`), so registering it covers every href and every pattern.

**Measured in a scratch project, 2026-11-10:**
- the app is refused at the same three places a kit refuses (`href`, `push`, `params`);
- no module cycle;
- a package's `.d.ts` that types a prop with the registered href type refuses `"/missing"` in the app.

## What is removed

- **`createRouter` and `TypedRouterKit`.** One table per app is what the registration says, and a second door to
  the same types is a second thing to document and to keep in step.
- No migration path. Nobody uses the framework yet.

## Without a registration

Measured, the naive default is wrong: every href is accepted SILENTLY, and `params()` breaks to `never`. So the
unregistered type refuses, and says why:

```
Type '"/about"' is not assignable to type '"Register your route table: declare module \"@ramonda/router\" { interface Register { routes: typeof routes } }"'.
```

- **Applies to:** `Link href`, `push`, `replace`, `route()` and `params(pattern)`.
- **Still allowed:** `params()` with no pattern keeps its untyped door.
- **A missing registration cannot pass quietly.** The first link fails with the fix in the message.

## A component in a package

**What the package types against:** the registered table, through two exported types:
- `Href`, any href the app's table accepts;
- `ParamsOf<…>`.

```ts
// in the package
import type { Href } from "@ramonda/router";
export class UserCard extends Component<{ href: Href }> { … }
```

- **In the app:** `<UserCard href="/missing" />` is a type error.
- **Inside the package:** a literal like `<Link href="/users/1">` is refused by the unregistered type. That is
  deliberate, because a package does not know the app's paths. It takes its hrefs as props.

**Not in this proposal (phase 2):** a component that reads a param, `params(…)`, without naming the app's pattern.
- The package declares the TYPE it needs, for example "a param that is an id".
- The app mounts it on a route.
- `ramonda-check` confirms that route supplies it.

That is a checker rule over the graph, not a type, and gets its own proposal.

## Costs

**Changes:**
- Every docs page and template that writes `createRouter` changes. That is 18 files, and the change in each is
  mechanical.
- `ramonda-check` resolves kit members to their classes today (`const { Link } = createRouter(routes)`). Direct
  imports are simpler to resolve, but the kit-resolution code, its fixtures and its tests have to be replaced, not
  kept.

**Risks:**
- **A type-level loop remains,** from `typeof routes` to `Register` to `Link` and to a page. TypeScript accepts it
  because the augmentation is resolved lazily. It was measured on a small table only; a large one must be measured
  before this is built.
- **Global by design.** Two apps in one TypeScript program, a monorepo with one `tsconfig` over both, share one
  `Register`. The fix is one program per app, which is the normal setup. The docs must say it.

## Open questions

1. `RouteOutlet` takes `routes={routes}` explicitly, as today, or reads the registered table? Explicit is
   recommended: the runtime needs the value, a type cannot carry it, and a nested outlet has its own table anyway.
2. Where the registration lives: in `routes.tsx` beside the table (recommended), or in a `global.d.ts`.
