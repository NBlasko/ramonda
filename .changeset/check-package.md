---
"@ramonda/check": minor
"create-ramonda": minor
---

New package **`@ramonda/check`** — proves every context consumer has a provider above it, before
the app is ever opened.

The runtime diagnostic (RMD003) can only speak when a branch actually renders, so a consumer
behind a condition nobody exercised — or in a chunk nobody loaded — ships with the fault
undetected. The commonest way to get there is a reorder: the provider moves, the consumer stays,
and the page still renders because the context quietly falls back to its default.

```
$ ramonda-check-context

  src/App.tsx:57:11
    <UserPage> consumes "Theme" — nothing provides it on this path:
    App → Sidebar → UserPage
```

**It only reports what it can prove.** Anything it cannot resolve — a component chosen from a
variable, a registry, a prop — makes it go quiet for that path rather than guess, which is what
makes it safe to fail a build on: a report is a real broken path, never a maybe. It follows JSX
(children of a component belong to that component), `list({ as })`, route tables through
`<RouteOutlet routes={…}>`, and contexts a hook carries for its owner.

Scaffolded projects run it as the first step of `build`, so a lost provider fails the build
instead of reaching a browser. Existing projects: add `@ramonda/check` as a dev dependency and put
`ramonda-check-context && ` in front of your build script. `typescript` is a peer dependency — the
analyzer uses your compiler, so it reads your own syntax and config.
