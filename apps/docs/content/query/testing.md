---
title: Testing queries
description: Which of act and waitFor to reach for, and why a fresh client per test is not optional.
section: Async data
order: 97
---

# Testing queries

There is no query-specific test API, and that is not an omission — the two tools you
need are already in [`@ramonda/testing-library`](/testing), and the line between them
is the only thing worth learning.

## `act` for work already scheduled, `waitFor` for a round trip

[`act`](/testing/act) commits everything **already scheduled**: pending renders,
`@mount`s, effects. With an async callback it also gives the continuations a few
microtask turns and commits after each — so a fetcher that resolves from memory (a
cache hit, a stub returning `Promise.resolve(…)`) is fully settled by the time it
returns.

```ts
const { container } = render(<UserCard id="1" />);

await act(async () => {});
expect(container.querySelector("#name")!.textContent).toBe("Ada");
```

What `act` does **not** do is wait for a timer or a real request. For that, use
`waitFor` — it retries the assertion, and because renders are batched on a microtask
the DOM catches up between attempts with nothing else to arrange:

```ts
await waitFor(() => {
  expect(container.querySelector("#name")!.textContent).toBe("Ada");
});
```

`waitFor` comes from `@testing-library/dom`, which
[`@ramonda/testing-library` re-exports whole](/testing) — along with `screen`,
`within` and every query.

Getting this wrong fails in one specific way: the assertion reads `pending` because
the fetch had not landed. If that happens, you wanted `waitFor`.

## A fresh client per test

Give each test its own `QueryClient`, and the reason is the same one there is no
global client in the first place: a cache that outlives the test carries one test's
data into the next, and the failure shows up as an order-dependent test that passes
alone.

```tsx
function mount(client = new QueryClient()) {
  class Harness extends Component {
    private query = this.use(QueryClientProvider, () => ({ client }));
    render() {
      return <UserCard id="1" />;
    }
  }
  return { client, ...render(<Harness />) };
}
```

Passing the client in also gives the test a handle on the cache — `peek`, `setData`,
`invalidate`, `all` — which is usually a better assertion than digging through the
DOM:

```ts
const { client } = mount();
await act(async () => {});
expect(client.peek<User>(["user", "1"])!.data).toEqual({ name: "Ada" });
```

## Seeding instead of stubbing

A test about rendering does not have to go through a fetcher at all. `setData` puts
the data in the cache directly, and a query that finds fresh data does not fetch:

```ts
const client = new QueryClient({ defaults: { staleTime: 60_000 } });
client.setData(["user", "1"], { name: "Ada" });

const { container } = mount(client);
// Already filled in on the first render — no fetch, no waiting.
expect(container.querySelector("#name")!.textContent).toBe("Ada");
```

Without a `staleTime` the data is stale the moment it arrives, so mounting refreshes
it — see [`refetchOnMount`](/query/queries). That is usually what you want in an app
and rarely what you want in a test.

## Controlling time without a fake clock

`QueryClient` takes a `now` function. Staleness is arithmetic on timestamps, and a
test that has to advance a fake clock to check "is this five minutes old" ends up
testing the fake clock:

```ts
let now = 1_000;
const client = new QueryClient({ now: () => now, defaults: { staleTime: 1_000 } });

await client.fetch(["k"], loadThing);
expect(client.isStale(["k"], 1_000)).toBe(false);

now += 1_000;
expect(client.isStale(["k"], 1_000)).toBe(true);
```

For polling you do need a timer — fake only the one you mean, or the framework's own
update batching goes with it:

```ts
vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
```

## Asserting that something did NOT fetch

Most of what is interesting about a cache is the request that did not happen, so
count calls rather than only checking the rendered output:

```ts
const fetcher = vi.fn(async () => ({ name: "Ada" }));
// … mount two observers of the same key …
expect(fetcher).toHaveBeenCalledTimes(1);
```

## Failures

Reject from the fetcher and set `retry: 0`, or the test waits out the backoff:

```tsx
this.use(Query, () => ({
  key: ["user", "1"],
  fetch: async () => {
    throw new Error("503");
  },
  retry: 0,
}));
```

Remember that a failed refetch **keeps** the previous data — `status` becomes
`"error"` while `data` still holds the last good value — so assert on both if that is
the behaviour you care about.

## A server render, end to end

The SSR path is worth one test, because it is the part with no app wiring to inspect:

```ts
const html = await renderToString(<App />);
expect(html).toContain("Ada");

// Hydrate the very markup the server produced.
const { container } = render(<App />, { hydrate: html });

// Before any settling: the first client render must already show the server's data,
// or hydration would have thrown the markup away.
expect(container.querySelector("#name")!.textContent).toBe("Ada");
```

See [queries on the server](/query/server) for why that first render matters.

## Next

- [Testing](/testing) — rendering, `act`, hooks, and SSR in general.
