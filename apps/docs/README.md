# apps/docs

The Ramonda documentation site. Not built yet — see **[PLAN.md](./PLAN.md)** for the
information architecture, the measured example gap, and the build order.

It will be a Ramonda app, prerendered to static HTML by the pipeline in `@ramonda/core`
(`renderPage` → `renderDocument`) and `@ramonda/router` (`routePaths`).
