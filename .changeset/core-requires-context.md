---
"@ramonda/core": minor
---

Add `@requiresContext(...)` — declare the contexts a class needs, and hear about a missing provider
at **mount** instead of at the first read.

```tsx
@requiresContext(ThemeConsumer)
class Panel extends Component { … }
```

A consumer is reported (`RMD003`) only when something reads it, which is deliberate — holding a
consumer you read down one branch is not a mistake. The gap is a component that mounts and reads
nothing yet: a lazily-loaded chunk, or a condition that finally turned true. Declaring the
requirement closes it — appearing at all is enough to be checked, and a subclass adds to what its
parent declared.

Development-only: in a production build the declaration is inert. Works on hooks too. For the
branches no runtime check can reach — the ones nobody has opened — `@ramonda/check` proves the same
thing from the source before the app runs.
