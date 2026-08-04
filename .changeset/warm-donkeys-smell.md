---
"@ramonda/query": minor
"@ramonda/form": minor
"create-ramonda": patch
---

A devtools tab is its own entry, and a package only announces

```ts
if (import.meta.env.DEV) {
  void import("@ramonda/devtools");
  void import("@ramonda/query/devtools");
  void import("@ramonda/form/devtools");
}
```

Each tab now lives behind `/devtools` on its package, and importing that entry registers it.
`create-ramonda` writes these lines for the add-ons you pick.

**Why it moved.** A package that imports the module describing its tab puts that description into
the bundle of every application using the package — `__DEV__` strips it from production, but not
from development. Measured: 12.4 KB of query and 5.2 KB of form were in the development bundle of
every app, whether or not anyone ever opened the panel. Both are now only in the bundle of an app
that asked for a tab.

**How a package reaches its tab instead.** An event. `QueryClientProvider` and `Form` announce
themselves arriving and leaving with one `__DEV__`-guarded line each, and the entry listens and
keeps whatever list it needs. Nothing about a panel lives on the class — no field, no method, both
of which ship whatever the guard says — and the package does not know whether anybody is listening.

That is the shape core already uses for `ramonda:tick` and `ramonda:dev-log`.

Nothing changes for an app beyond the import lines: both tabs look and behave as before.
