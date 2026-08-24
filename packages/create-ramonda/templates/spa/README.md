# Ramonda app

A [Ramonda](https://ramonda.dev) single-page app, built with Vite.

## Develop

```bash
npm run dev      # start the dev server on http://localhost:3000
npm run build    # build for production into dist/
npm run preview  # preview the production build
```

## Where things are

- `src/main.tsx` — mounts `<App />` with `bootstrap`.
- `src/App.tsx` — your first component. A component is a class; `@state` marks a
  signal, and changing a signal re-renders the component.
- `vite.config.ts` — Ramonda needs `jsx: "automatic"` and `jsxImportSource: "@ramonda/core"`;
  both are set here.

## Learn Ramonda

The docs — from the first component to how the renderer works — are at
**https://ramonda.dev**.
