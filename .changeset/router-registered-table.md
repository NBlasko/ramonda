---
"@ramonda/router": minor
"create-ramonda": minor
---

The route table is registered once instead of handed to `createRouter`. `createRouter` and `TypedRouterKit` are gone; `Link`, `Navigator` and `route` are imported from `@ramonda/router`, typed against the table an app registers beside it:

```ts
export const routes = createRoutes({ "/": <Home />, "/u/:id": <Profile /> });

declare module "@ramonda/router" {
  interface Register {
    routes: typeof routes;
  }
}
```

The kit had to be imported from the module that holds the table, which imports every page, so every page and that module imported each other. A page now imports only the package. Without a registration the first `<Link href>` fails to compile, with the line to write in the message. `Href` is every href the registered table accepts — what a component in a package types an href prop with, so the app's table checks what the app passes. The brand `route()` returns is `BuiltHref`. The SSR templates register their table.
