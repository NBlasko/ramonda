---
"@ramonda/core": patch
---

`RMD050` — a decorator whose effect the member already has

```tsx
@state @state count = 0;        // reported: the second installs the same accessor
@state @persist token = "";     // reported: @state already puts a field in the blob
```

A warning rather than an error, because the member ends up right either way — a doubled `@state` renders
once per write with the right value. What is wrong is the belief that the second line did something.

**Reported through the CAPABILITY, not the decorator's name**, which is what catches the second case at
all: `@state` and `@persist` are two spellings of "this field travels in the hydration blob", so a check
keyed on names would have seen two different decorators and said nothing.

**Most pairs on one member are silent, and that is the half worth stating.** `@created` with `@updated`,
`@mounted` with `@destroyed`, `@onWindow` with `@onDocument`, `@interval` with `@timeout`, `@watchProp`
with `@updated` — each measured as doing real work twice, which is the reason for writing two. And the
pairs that make no sense at all already threw before this existed: `@state` with `@compute`, `@compute`
with `@persist`, `@state` with `@watchProp`, `@memoizedHandler` with `@compute` name the member and what
it is, because one of the two is on the wrong kind of member.

Once per member, not once per instance, so a list of a thousand rows says it once. Development only: the
record it keeps is a `Set` on the instance behind `__DEV__`, and a production build allocates none of it.
