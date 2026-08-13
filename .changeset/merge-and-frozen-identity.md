---
"@ramonda/core": minor
"@ramonda/query": patch
---

`merge()` — structural sharing, and the one place an app can say which row is which.

`list()` infers identity, and for the shapes real data takes it is right. But it is inference, and there was no way to tell it otherwise. `merge` is that way, and it sits at the data boundary rather than on the list — said once, where the rows arrive, instead of on every list that renders them.

```ts
this.rows = merge(this.rows, await api.getRows());              // shares what did not change
this.rows = merge(this.rows, await api.getRows(), (r) => r.id); // and pairs rows across a reorder or a resize
```

With an identity, an unchanged row comes back as the same object wherever it moved to, and a changed row carries its predecessor's identity so it updates in place instead of being rebuilt. Without one, a refetch that changed nothing is not a change at all.

`@ramonda/query` has done the structural-sharing half on every fetch for a while; it now uses this implementation, so an app gets the same function with the same bounds whether its data came through a query or not.

**Also fixed:** a frozen row kept no identity. `Object.defineProperty` throws on a frozen object, so a refetch of frozen rows rebuilt every one of them — measured, changed or not. The write falls back to a WeakMap, so freezing your data no longer costs you row identity.
