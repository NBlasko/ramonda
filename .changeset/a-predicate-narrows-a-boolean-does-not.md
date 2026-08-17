---
"@ramonda/core": patch
---

A predicate narrows; a `boolean` does not — which is why one probe was written seven ways.

`vdom/h.ts` held a local whose only job was to hold a cast:

```ts
const vnode = child as { type?: unknown; name?: unknown; attributes?: { key?: unknown } };
```

Measured across the repository, non-test and non-dist: **76 `as { … }` casts, 42 of them bound to a
local `const`**. About half are legitimate and stay — `globalThis as { CSS?… }`,
`window as unknown as { __RAMONDA_INSPECT__ }`, `JSON.parse(raw) as { … }` are real boundaries with an
untyped host on the other side.

The rest were one fact spelled several ways, and the cause is worth naming: a helper that returns
`boolean` answers the question and narrows nothing, so the caller casts on the very next line anyway.
`isListLike` in `h.ts` and `isVNode` in `debug/renderStability.ts` were both that shape, and both had
an anonymous `as { … }` sitting under them.

`vdom/guards.ts` now holds the two predicates the vdom actually asks, as `value is ListNode` and
`value is VNode`. It is a leaf on purpose: `isListNode` used to live in `core/DiffAndMerge.ts`, which
imports `generateRenderOutput`, so half the callers could never have imported it back.

- **Seven hand-rolled `IS_LIST` probes become one call** — `h.ts` ×2, `helpers/listEngine.ts`,
  `helpers/generateRenderOutput.ts`, `debug/renderStability.ts` ×2, `debug/lintChildren.ts`.
- **A `@ts-ignore` in `normalizeChildren` is gone**, because the line under it was asking exactly what
  `isVNode` asks.
- **Four byte-identical copies of `constructor?.name ?? "Unknown"`** — `hydration/serialize.ts`,
  `hydration/restore.ts`, `hydration/lint.ts`, `helpers/watchProps.ts` — plus three `this` casts in
  `base/decorators.ts`, become `displayName`. `base/Context.ts` keeps its own: there `undefined` is an
  answer the message branches on, and `"Unknown"` would change what RMD003 prints.
- The two remaining `owner` casts say what they do — they defeat `readonly`, because stamping an
  owner is those two lines' job and nobody else's.

Left alone deliberately: `isLazyList` asks a different question (a descriptor, not a built list) and
was already a proper predicate; `debug/renderStability.ts` keeps a LOOSER local check, because it
walks two arbitrary render outputs looking for instability rather than deciding what may reach the
diff.

Measured, because a shared guard is a function call in a hot path: 1000 children × 20 000 passes over
a realistic mix of vnodes, lists and holes — the call is **0.80×–0.91× the inline probe** across five
rounds, under half a nanosecond per probe and if anything in the guard's favour. Production bundle:
raw **−58 bytes**, gzipped **+94** (22 450 → 22 544), the difference being chunk boundaries moving
rather than code being added.

Faults planted, and the second one is the reason this ships with a test. Loosening `isListNode` to
"any object" fails **908 of core's 1066 tests**. Loosening `isVNode` to the "has a `type` and a
`name`" spelling passed **all 1066** — nothing pinned the strictness at all, and a foreign object
carrying two very ordinary field names would have been waved past RMD037 and into the diff.
`src/__tests__/VNodeGuards.test.tsx` closes that, end to end as well as at the unit.
