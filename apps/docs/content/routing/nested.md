---
title: Nested outlets
description: A routed page that has routes of its own.
section: Routing
order: 84
---

# Nested outlets

A routed page can have routes of its own — a settings screen with Profile, Billing
and Team tabs. Put a second `<RouteOutlet>` inside the page:

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

The outer table names every path that should render `Settings`, because matching is
on the whole pathname, not segment by segment. The upside: the route table stays a
flat list you can read top to bottom.

## What stays put across navigation

Moving between `/settings/billing` and `/settings/team` re-renders only the **inner**
outlet. `Settings` and its `SettingsNav` are the same instances — same state, same
scroll position, no remount — because the outer match didn't change. It is the
nav-bar property, one level down.

## Params at each level

Each outlet publishes the params *it* matched, and a component reads the nearest
outlet above it:

```tsx
const { teamId } = this.route.params<{ teamId: string }>();
```

## Next

- [The router on the server](/routing/server).
