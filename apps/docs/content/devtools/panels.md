---
title: Adding a tab
description: Register a panel from your own library, so what it holds shows up in the devtools next to the component tree and the query cache.
section: Devtools
order: 106
---

# Adding a tab

A library with state worth looking at can put a tab in the panel. `QUERY` and `FORMS` are built this
way — nothing about a cache or a form is written into `@ramonda/devtools`, and yours works the same.

## The app asks for it

```ts
if (import.meta.env.DEV) {
  void import("@ramonda/devtools");
  void import("@ramonda/query/devtools");
  void import("@ramonda/form/devtools");
}
```

A tab lives in its own entry, and importing that entry registers it. Nothing is exported to call.

This is why: a package that imported the panel would put its whole tab description into the bundle
of every application using it, whether or not anyone opens the devtools. A separate entry is only in
the bundle of an app that asked for one. `create-ramonda` writes these lines for the add-ons you
pick.

```ts
import { panelRegistry } from "@ramonda/devtools";

const off = panelRegistry().register({
  version: 1,
  id: "sockets",
  label: "SOCKETS",

  snapshot: () => ({
    empty: "No sockets open.",
    groups: [
      {
        rows: [
          {
            id: "ws-1",
            title: "wss://api.example.com",
            code: true,
            status: "ok",
            fields: [
              { kind: "text", text: "open · 3 subscriptions" },
              { kind: "live", id: "age", text: "last message 4s ago" },
            ],
            value: { data: lastFrame, revision: frameCount },
            actions: [{ id: "close", label: "close" }],
          },
        ],
      },
    ],
  }),

  run: (rowId, actionId) => {
    if (actionId === "close") sockets.get(rowId)?.close();
    return undefined;
  },
});
```

`register` hands back the function that removes the tab.

## You return data, the panel draws it

There is no way to hand the panel markup, and that is deliberate. Rendering stays the panel's, so
every tab looks like part of one tool, the panel is free to change how a row reads, and a mistake in
your template cannot break the thing somebody opened *because* something was already wrong.

It also keeps the contract small enough to version honestly — `version: 1`, and a panel that meets a
version it does not know skips the tab rather than half-drawing it.

## A row is a card

| Part | What it is for |
| --- | --- |
| `id` | Stable across polls, unique within your tab. What actions and values are addressed by. |
| `title` | The heading. `code: true` puts it in a monospace box — for a key, a path, a URL. |
| `status` | `"ok"`, `"busy"`, `"error"` or `"idle"`. You say which; the panel owns the colours. |
| `fields` | The line under the title. See below. |
| `error` | Shown in full, in the error style. Leave it out when there is nothing wrong. |
| `value` | Rendered with the panel's own value tree, openable on the whole panel. |
| `actions` | Buttons. Pressing one calls your `run(rowId, actionId)`. |

Rows come in groups, and a group's `label` is a heading above its rows — worth using when your
source has more than one of something, like a page with two query clients. One group with no label
is the ordinary case.

### Fields

```ts
{ kind: "text",  text: "3 observers" }
{ kind: "live",  id: "age", text: "updated 12s ago" }
{ kind: "badge", text: "fetching…", tone: "warn" }
```

`text` and `live` are joined into one metadata line; badges sit next to the title.

**Use `live` for anything that changes on its own** — a clock, a countdown, a byte counter. The panel
rebuilds a list only when its *shape* changes, and a live field is excluded from that shape: its text
is written straight into its own node. Without it, a row saying "updated 12s ago" would rebuild the
whole list twice a second, which resets hover, text selection and any editor the reader has open.

### Values

```ts
value: {
  data: entry.data,
  revision: entry.updatedAt,
  editable: true,
  write: (next) => (save(next) ? undefined : "that entry is no longer there"),
  writeNote: "a refetch will replace it",
}
```

`data` gets the collapsible tree, the full view and the copy button, for free.

**`revision` is worth supplying whenever you have one** — a write timestamp, a counter, a hash.
Without it the panel decides whether the value moved by looking at its shape, which misses a field
changed in place or an eighth page appended to a list of seven. The alternative, serialising your
payload on every poll, is the most expensive thing the panel could do.

`write` returns the **reason it refused**, or nothing when the write was taken. Say no whenever
writing back would be dishonest: `@ramonda/form` refuses because a form's values are the schema's
input side and JSON cannot round-trip a `Date`; `@ramonda/query` refuses for a value that arrived
bounded, because sending it back would put the truncation markers into the cache.

## Announce from your package; listen from the entry

Your package should not import the module that describes your tab — that is what would drag the
description into everybody's bundle. Send an **event** instead, and let the entry listen:

```ts
// @ramonda/sockets — guarded, so __DEV__ removes it
@created join() {
  if (__DEV__) {
    this.announce();
    // And again whenever a panel asks: see below for why once is not enough.
    window.addEventListener("sockets:request", this.announce);
  }
}

announce() {
  window.dispatchEvent(new CustomEvent("sockets:open", { detail: { socket: this } }));
}

@destroyed leave() {
  if (__DEV__) {
    window.removeEventListener("sockets:request", this.announce);
    window.dispatchEvent(new CustomEvent("sockets:closed", { detail: { socket: this } }));
  }
}
```

```ts
// @ramonda/sockets/devtools — imported only by an app that wants the tab
const live = new Set<Socket>();
type SocketEvent = CustomEvent<{ socket: Socket }>;

window.addEventListener("sockets:open", (e) => live.add((e as SocketEvent).detail.socket));
window.addEventListener("sockets:closed", (e) => live.delete((e as SocketEvent).detail.socket));

panelRegistry().register({ version: 1, id: "sockets", label: "SOCKETS", snapshot, run });

// Last: ask what is already here, now that the listeners above are in place.
window.dispatchEvent(new CustomEvent("sockets:request"));
```

**Ask on load, or the tab starts empty.** This entry arrives through a dynamic import, so it loads
*after* the app has mounted — and anything that announced itself during that mount announced to
nobody. For something that comes and goes you might not notice; for something that mounts once at
the root you never see it at all. `@ramonda/query` shipped exactly that: `QueryClientProvider`
announces from `@created`, which runs during hydration, and the QUERY tab was empty for the life of
every page until the panel started asking.

**From a lifecycle, not at module load.** A source that registers when its module loads lists
something that may never mount, and never stops listing it. Announcing from `@created` and `@destroyed`
means the list is exactly what is live — and the tab's ROWS appear and disappear with them.

**The tab itself does not.** It is registered once, when its entry is imported, and never
deregistered — so a submit that redirects, or any navigation that unmounts the last of something,
leaves the tab in place saying there is none. That is what `empty` is for. A tab that came and went
as somebody moved around an app would be unusable exactly when they are trying to follow something
across pages.

**Nothing about the panel belongs on your class.** Not a field holding a cleanup, not a method that
builds a row: a class member cannot be tree-shaken, whatever guard surrounds its call, so it ships.
Keep the list and the description in the entry, and leave one `if (__DEV__)` line at each end.

This is the same shape core uses for `ramonda:tick` and `ramonda:dev-log`.

## The panel pulls

`snapshot()` is called **only while your tab is open**, twice a second. It is never called for a tab
nobody is looking at, and never at all when the panel is closed.

So read state in it rather than computing over it, and do not push: a cache that notified the panel
on every change would cost something in every development build whether or not anybody had it open.
If your `snapshot()` throws, the tab says so and the rest of the panel carries on.

## An id is yours, and it comes back untouched

The panel treats `id` as opaque: it stores it, addresses actions and values by it, and hands it to
`run(rowId, actionId)` byte for byte. It never splits one, because it cannot know what a separator
would be in your ids.

So put in it whatever `run` needs in order to find the thing again — including structure.
`@ramonda/query` writes `0::["products"]`, which is the client's index and the key, joined; `run`
splits on `::` and looks both up. A plain `"ws-1"` is just as good when a plain lookup is all it takes.

**What an id must be is stable across polls**, because that is how the panel knows the row it is
looking at is the same row. An id built from something that moves — a position in a list, a counter —
makes every poll look like a different set of rows, which resets whatever the reader had open.

## Next

- [Devtools](/devtools) — the tabs that ship, if you have arrived here first.
- [Writing a hook](/hooks/writing) — where the state a panel shows usually lives.
