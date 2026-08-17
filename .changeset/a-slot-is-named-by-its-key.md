---
"@ramonda/core": minor
---

A per-request slot is named by its key, not by a string written twice.

`renderToString(vnode, { request })` took its pre-resolved values as `Map<string, unknown>` — a
label the server writes, and the same label written again where the slot is declared, with nothing
relating the two. It is now `Map<RequestKey<unknown>, unknown>`: the key itself.

**Why a type and not a check.** Measured before the change: seeding `"currentUsr"` against a key
declared `"currentUser"` renders `undefined` into the page **on the server**, silently. No
diagnostic could have caught it either, and that is the interesting part — a read is legitimately
allowed to find nothing, because an anonymous visitor has no user, so at runtime a typo and an
absent value are the same event. The only place to refuse it is where the two spellings meet, and
naming the key means there is only one.

**`exposedLabels` is gone.** It was a module-level set that `requestKey` added to as a side effect,
and the serializer consulted it when stamping the page — so what a page exposed depended on whether
the module declaring the key had been **imported** yet. Measured: the same render with the same
seeded value emitted no client blob before the declaration ran and a full one after, which is what a
key declared in a lazily-loaded route would have hit. Exposure is read from the key now and kept on
the request scope.

Worth stating precisely, because the two are easy to confuse: what closes the lateness is the seed
taking a **key**, not exposure moving off the registry. You cannot seed without holding the key, and
holding it means `requestKey` has already run. The registry became unreachable rather than wrong,
and was deleted because dead state is worth deleting.

Migration is mechanical, and the compiler names every site:

```diff
- values: new Map([["currentUser", user]]),
+ values: new Map([[currentUser, user] as const]),
```

`seedRequest(key, value)` is unchanged and remains the door for anything resolved once the render is
under way — it also ties each value's type to its own key, which a heterogeneous map cannot: the map
checks that every entry IS a key, and stops there.

Two tests came out of planting rather than out of writing. `seedRequest` had leaned on the same
registry for exposure and had to start marking it itself — a regression this change introduced, that
none of the 165 hydration tests caught. And the first test written for the lateness claimed to catch
the old bug while passing either way, because the old bug is no longer reachable through the new
door; it now asserts only the property that survives.
