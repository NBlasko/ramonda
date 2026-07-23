---
title: Nested outlets
description: A route that has routes of its own.
section: Routing
order: 84
---

# Nested outlets

An outlet may contain another outlet. The inner one matches the same pathname, so its patterns
include the outer prefix.

```tsx
const settingsRoutes = createRoutes({
  "/settings": <Profile />,
  "/settings/billing": <Billing />,
  "/settings/team": <Team />,
});

@Host("section")
class Settings extends Component {
  render() {
    return (
      <div className="settings">
        <SettingsNav />
        <RouteOutlet routes={settingsRoutes} />
      </div>
    );
  }
}

const routes = createRoutes({
  "/": <Home />,
  "/settings": <Settings />,
  "/settings/billing": <Settings />,
  "/settings/team": <Settings />,
  "*": <NotFound />,
});
```

The outer table has to name every path that should render `Settings`, because matching is on the
whole pathname rather than segment by segment. That is more explicit than a nested route tree, and
it means the route table is a flat list you can read.

## What survives a navigation

Moving between `/settings/billing` and `/settings/team` re-renders the **inner** outlet only.
`Settings` and its `SettingsNav` are the same instances — same state, same scroll position, no
remount — because the outer outlet's match did not change.

That is the same property the top-level nav bar has, applied one level down.

## Params at each level

Each `<RouteOutlet>` publishes the params **it** matched. A component reads the params of the
nearest outlet above it:

```tsx
const { teamId } = this.route.params<{ teamId: string }>();
```

## Next

- [The router on the server](/routing/server) — what changes, and what does not.
