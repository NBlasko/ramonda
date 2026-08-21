# @ramonda/router

Client-side routing for [Ramonda](https://ramonda.dev): state-first, race-free navigation
with nested route outlets.

[![npm](https://img.shields.io/npm/v/%40ramonda%2Frouter)](https://www.npmjs.com/package/@ramonda/router)
[![license](https://img.shields.io/npm/l/%40ramonda%2Frouter)](https://github.com/NBlasko/ramonda/blob/main/LICENSE)

```tsx
import { Component, Host } from "@ramonda/core";
import { createRouter, createRoutes } from "@ramonda/router";

const routes = createRoutes({
  "/": <Home />,
  "/posts/:id": <Post />,
  "*": <NotFound />,
});

// Once, in a module of its own. `Link` and `Navigator` come from here and nowhere else — each is
// bound to THIS table, so `href` and `push` take the paths it names and nothing else.
export const { Router, RouteOutlet, Link, Navigator, route } = createRouter(routes);

@Host("div")
export class App extends Component {
  // Mount the router once, on the component that wraps your app.
  router = this.use(Router);

  render() {
    return (
      <div>
        <nav>
          <Link href="/">Home</Link>
          <Link href="/posts/42">A post</Link>
        </nav>
        <RouteOutlet routes={routes} />
      </div>
    );
  }
}
```

## Why it looks like this

- **The `Router` is a hook, not a wrapper element.** It mounts on the component that already
  wraps your app, so the shell stays a single element and anything beside the outlet — a sidebar,
  a header — keeps its state across navigation instead of being rebuilt.
- **State-first, so it cannot race.** Navigation updates one piece of route state and the outlet
  renders from it; the URL and what is on screen are derived from the same source, so they cannot
  disagree. A left click, the back button, and a server render all go through the same channel.
- **`<Link>` is a real `<a>`.** Its host element *is* the anchor, so middle-click, open-in-new-tab,
  and crawlers get a proper `href`; a plain left click is intercepted and routed client-side.
- **Outlets nest.** A `<RouteOutlet>` inside a matched route renders the next segment, so layouts
  compose without a central route tree.

## Server rendering

`routePaths(routes)` enumerates every literal path, which is what lets a static build prerender
the whole site. On the server the router reads the request URL; on the client it reads
`window.location` — the same code, so hydration adopts the server's markup.

See the [routing guide](https://ramonda.dev/routing) for params, nested outlets, and the
server story in full.

## License

[MIT](../../LICENSE) © Nikola Blagojević
