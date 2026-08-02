---
"@ramonda/core": minor
"@ramonda/router": patch
---

A missing context provider (`RMD003`) is now reported when the consumer **mounts**, not when a
value is first read — and nothing has to be declared to get it.

The information was always in the hook: `this.use(ThemeConsumer)` names the context, and the
consumer resolves its provider once, at construction. So the answer exists at mount. Waiting for a
read gave the same answer later, and for a value read only down a branch nobody clicks, never at
all — which is the fault worth catching: the page renders, the default fills in, nothing looks
wrong.

The report names the component the provider has to go above:

```
[RMD003] Context consumed without a provider above it
<Panel /> mounts ThemeConsumer with no Provider on any ancestor, so every key it reads
gets the default below.
```

`createContext` takes one new option, for the case where the default IS the answer:

```tsx
const [ParamsProvider, ParamsConsumer] = createContext(
  { params: {} },
  { label: "RouteParams", optional: true },
);
```

The flag belongs to the context, not to each consumer — whoever wrote `createContext` is the one
who knows whether the default is a real answer or a stand-in for something missing, and they say it
once. The router's `params` context is marked `optional`, because a nav bar beside the outlet
legitimately has no matched route above it. `@ramonda/check` honours the same flag, so the static
and runtime checks agree.

Development-only, as before: a production build reports nothing and reads exactly the same values.
