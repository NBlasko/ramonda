import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { focusOn } from "../index";

interface Post {
  id: number;
  title: string;
  tags: string[];
  draft?: boolean;
}

interface AppState {
  users: { id: number; name: string }[];
  posts: Post[];
}

function makeState(): AppState {
  return {
    users: [{ id: 1, name: "Nikola" }],
    posts: [
      { id: 101, title: "First post", tags: ["js", "web"] },
      { id: 102, title: "Second post", tags: ["ssr", "draft"] },
    ],
  };
}

/** Everything printed, whichever channel a severity routed it to. */
let warned: string[] = [];
/** Everything a collector would have received. Asserted by code, not by prose. */
let records: RamondaDiagnostic[] = [];
let spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  warned = [];
  records = [];
  // Both channels: an `error` severity prints with `console.error`, and the suite
  // asks "what was reported", which is a question about the report and not about
  // which console method carried it.
  spies = (["warn", "error"] as const).map((channel) =>
    vi.spyOn(console, channel).mockImplementation((message: unknown) => {
      warned.push(String(message));
    }),
  );
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
});

const codes = (): string[] => records.map((record) => record.code);

describe("the shape of the result", () => {
  test("edits the focused value and leaves the rest alone", () => {
    const state = makeState();

    const next = focusOn(state)
      .get("posts")
      .where((post) => post.id === 102)
      .get("tags")
      .where((tag) => tag === "draft")
      .set("published");

    expect(next.posts[1].tags).toEqual(["ssr", "published"]);
    expect(next).toEqual({
      users: [{ id: 1, name: "Nikola" }],
      posts: [
        { id: 101, title: "First post", tags: ["js", "web"] },
        { id: 102, title: "Second post", tags: ["ssr", "published"] },
      ],
    });
  });

  test("never mutates the input", () => {
    const state = makeState();
    const before = structuredClone(state);

    focusOn(state)
      .get("posts")
      .where((post) => post.id === 102)
      .get("title")
      .set("changed");

    expect(state).toEqual(before);
  });
});

/**
 * The reason the package exists. A consumer doing a shallow compare must be able
 * to reject an untouched branch on a `===` — so every reference OFF the path has
 * to survive, and every reference ON it has to be new.
 */
describe("structural sharing", () => {
  test("new references on the path, identical references everywhere else", () => {
    const state = makeState();

    const next = focusOn(state)
      .get("posts")
      .where((post) => post.id === 102)
      .get("tags")
      .where((tag) => tag === "draft")
      .set("published");

    // On the path: root, posts, posts[1], posts[1].tags.
    expect(next).not.toBe(state);
    expect(next.posts).not.toBe(state.posts);
    expect(next.posts[1]).not.toBe(state.posts[1]);
    expect(next.posts[1].tags).not.toBe(state.posts[1].tags);

    // Off the path: everything else, down to the sibling tag string's slot.
    expect(next.users).toBe(state.users);
    expect(next.users[0]).toBe(state.users[0]);
    expect(next.posts[0]).toBe(state.posts[0]);
    expect(next.posts[0].tags).toBe(state.posts[0].tags);
    expect(next.posts[1].title).toBe(state.posts[1].title);
  });

  test("a write of an equal value returns the original root untouched", () => {
    const state = makeState();

    const next = focusOn(state)
      .get("posts")
      .where((post) => post.id === 102)
      .get("title")
      .set("Second post");

    // Not "deeply equal" — the very same object. No level was copied at all.
    expect(next).toBe(state);
    expect(next.posts).toBe(state.posts);
    expect(next.posts[1]).toBe(state.posts[1]);
  });

  test("update that returns the same value is also a no-op", () => {
    const state = makeState();
    const next = focusOn(state)
      .get("posts")
      .at(0)
      .update((post) => post);

    expect(next).toBe(state);
  });

  test("merge of unchanged fields returns the original root", () => {
    const state = makeState();
    const next = focusOn(state).get("posts").at(0).merge({ title: "First post" });

    expect(next).toBe(state);
  });

  test("a multi-match write copies the array exactly once", () => {
    const state: { posts: Post[] } = {
      posts: [
        { id: 1, title: "a", tags: [], draft: true },
        { id: 2, title: "b", tags: [], draft: false },
        { id: 3, title: "c", tags: [], draft: true },
      ],
    };

    const next = focusOn(state)
      .get("posts")
      .where((post) => post.draft === true)
      .get("title")
      .set("TODO");

    expect(next.posts.map((p) => p.title)).toEqual(["TODO", "b", "TODO"]);

    // Both matches were edited, but `posts` is one new array, and the element
    // that did not match kept its identity.
    expect(next.posts).not.toBe(state.posts);
    expect(next.posts[1]).toBe(state.posts[1]);
    expect(next.posts[0]).not.toBe(state.posts[0]);
    expect(next.posts[2]).not.toBe(state.posts[2]);
  });
});

describe("where", () => {
  test("edits every match", () => {
    const state = { nums: [1, 2, 3, 4] };
    const next = focusOn(state)
      .get("nums")
      .where((n) => n % 2 === 0)
      .set(0);

    expect(next.nums).toEqual([1, 0, 3, 0]);
  });

  test("no match changes nothing and says so", () => {
    const state = makeState();
    const next = focusOn(state)
      .get("posts")
      .where((post) => post.id === 999)
      .get("title")
      .set("x");

    expect(next).toBe(state);
    expect(warned.join("\n")).toContain("matched no element");
  });

  test("narrows the element type when asked explicitly", () => {
    const state = { values: [1, "two", 3, "four"] as (number | string)[] };

    const next = focusOn(state)
      .get("values")
      .where<string>((value) => typeof value === "string")
      // `value` is `string` here, not `number | string`.
      .update((value) => value.toUpperCase());

    expect(next.values).toEqual([1, "TWO", 3, "FOUR"]);
  });

  test("an equality predicate does NOT narrow to a literal type", () => {
    const state = { tags: ["js", "web"] };

    // Inferred type predicates would make this `Focus<…, "js">` and reject the
    // write. The focused type has to stay `string`.
    const next = focusOn(state)
      .get("tags")
      .where((tag) => tag === "js")
      .set("ts");

    expect(next.tags).toEqual(["ts", "web"]);
  });
});

describe("at", () => {
  test("descends by position", () => {
    const state = makeState();
    const next = focusOn(state).get("posts").at(0).get("title").set("changed");

    expect(next.posts[0].title).toBe("changed");
    expect(next.posts[1]).toBe(state.posts[1]);
  });

  test("counts from the end when negative", () => {
    const state = makeState();
    const next = focusOn(state).get("posts").at(-1).get("title").set("last");

    expect(next.posts[1].title).toBe("last");
  });

  test("out of range changes nothing and says so", () => {
    const state = makeState();
    const next = focusOn(state).get("posts").at(9).get("title").set("x");

    expect(next).toBe(state);
    expect(warned.join("\n")).toContain("out of range");
  });
});

describe("operations", () => {
  test("update receives the focused value", () => {
    const state = makeState();
    const next = focusOn(state)
      .get("posts")
      .at(1)
      .get("tags")
      .update((tags) => [...tags, "added"]);

    expect(next.posts[1].tags).toEqual(["ssr", "draft", "added"]);
  });

  test("merge assigns over the focused object", () => {
    const state = makeState();
    const next = focusOn(state)
      .get("posts")
      .where((post) => post.id === 101)
      .merge({ title: "renamed", draft: true });

    expect(next.posts[0]).toEqual({
      id: 101,
      title: "renamed",
      tags: ["js", "web"],
      draft: true,
    });
    expect(next.posts[0].tags).toBe(state.posts[0].tags);
  });

  test("push appends to the focused array", () => {
    const state = makeState();
    const next = focusOn(state).get("posts").at(0).get("tags").push("ssr", "vdom");

    expect(next.posts[0].tags).toEqual(["js", "web", "ssr", "vdom"]);
    expect(next.posts[1]).toBe(state.posts[1]);
  });

  test("push of nothing is a no-op", () => {
    const state = makeState();
    expect(focusOn(state).get("posts").push()).toBe(state);
  });

  test("insert places items at a position", () => {
    const state = { tags: ["a", "d"] };
    expect(focusOn(state).get("tags").insert(1, "b", "c").tags).toEqual(["a", "b", "c", "d"]);
  });

  test("insert at length appends", () => {
    const state = { tags: ["a", "b"] };
    expect(focusOn(state).get("tags").insert(2, "c").tags).toEqual(["a", "b", "c"]);
  });

  test("insert past the end changes nothing and says so", () => {
    const state = { tags: ["a"] };
    expect(focusOn(state).get("tags").insert(5, "b")).toBe(state);
    expect(warned.join("\n")).toContain("not a valid insertion point");
  });

  test("insert counts from the end when the index is negative", () => {
    const state = { tags: ["a", "b", "c"] };
    // -1 is "before the last element", which is what makes `insert` able to reach
    // every gap: 0 is the front, -1 is one from the back, `length` appends.
    expect(focusOn(state).get("tags").insert(-1, "x").tags).toEqual(["a", "b", "x", "c"]);
    expect(
      focusOn({ tags: ["a", "b"] })
        .get("tags")
        .insert(-2, "x").tags,
    ).toEqual(["x", "a", "b"]);
  });
});

/**
 * The asymmetry this closes: `set` created a missing key while `push` on the same
 * missing key warned and did nothing, so the two spellings of one intent
 * disagreed — and the type system offered both.
 */
describe("writing into an array that is not there yet", () => {
  interface Draft {
    id: number;
    tags?: string[];
    labels: string[] | null;
  }

  const draft = (): { draft: Draft } => ({ draft: { id: 1, labels: null } });

  test("push creates the array when the key is absent", () => {
    const state = draft();
    const next = focusOn(state).get("draft").get("tags").push("a", "b");

    expect(next.draft.tags).toEqual(["a", "b"]);
    expect(next).not.toBe(state);
    // Creating it is a real change, so there is nothing to report.
    expect(warned).toEqual([]);
  });

  test("push creates the array when the value is null", () => {
    const state = draft();
    const next = focusOn(state).get("draft").get("labels").push("x");

    expect(next.draft.labels).toEqual(["x"]);
    expect(warned).toEqual([]);
  });

  test("insert creates the array too, and still rejects an unreachable position", () => {
    const state = draft();
    expect(focusOn(state).get("draft").get("tags").insert(0, "a").draft.tags).toEqual(["a"]);

    const missed = focusOn(draft()).get("draft").get("tags").insert(3, "a");
    expect(missed.draft.tags).toBeUndefined();
    expect(warned.join("\n")).toContain("has 0 element(s)");
  });

  test("`set` and `push` now agree, and both share everything off the path", () => {
    const state = draft();
    const viaPush = focusOn(state).get("draft").get("tags").push("a");
    const viaSet = focusOn(state).get("draft").get("tags").set(["a"]);

    expect(viaPush.draft.tags).toEqual(viaSet.draft.tags);
    expect(viaPush.draft.id).toBe(state.draft.id);
  });

  test("pushing nothing does NOT create an empty array", () => {
    const state = draft();
    const next = focusOn(state).get("draft").get("tags").push();

    // A no-op has to stay a no-op: the original root, not a copy with `tags: []`.
    expect(next).toBe(state);
    expect("tags" in next.draft).toBe(false);
  });

  test("inserting nothing does not create one either", () => {
    const state = draft();
    // The same rule `push()` follows, and it has to hold for both or the pair disagrees
    // about what "no items" means.
    const result = focusOn(state).get("draft").get("tags").insert(0);
    expect(result).toBe(state);
    expect("tags" in result.draft).toBe(false);
  });

  test("two created arrays are two arrays", () => {
    // The create path returns a fresh `[]` each time. Returning one shared empty array would
    // be invisible until two writes landed in the same place — which nothing else would catch,
    // because both results LOOK right on their own.
    const one = focusOn(draft()).get("draft").get("tags").push("a");
    const two = focusOn(draft()).get("draft").get("tags").push("b");

    expect(one.draft.tags).toEqual(["a"]);
    expect(two.draft.tags).toEqual(["b"]);
    expect(one.draft.tags).not.toBe(two.draft.tags);
  });

  test("insert cannot reach a gap that is not there in an array it just created", () => {
    // An empty array has exactly one insertion point, 0. A negative index counts from the end
    // and there is no end, so -1 is out of range rather than "the front".
    const state = draft();
    expect(focusOn(state).get("draft").get("tags").insert(-1, "a")).toBe(state);
    expect(warned.join("\n")).toContain("has 0 element(s)");
  });

  test("a value that IS there and is not an array is still refused", () => {
    const state = { count: 3 };
    const next = focusOn(state as unknown as { count: number[] })
      .get("count")
      .push(1);

    expect(next).toBe(state);
    expect(warned.join("\n")).toContain("is not an array, so `push` did nothing");
  });

  test("merge deliberately does not create — a Partial cannot fill a whole object", () => {
    const state: { post?: { id: number; title: string } } = {};
    const next = focusOn(state).get("post").merge({ title: "x" });

    // `{ title: "x" }` is not a `{ id, title }`, so creating from it would mint a
    // half-built object typed as a whole one. `set` is the operation that creates.
    expect(next).toBe(state);
    expect(warned.join("\n")).toContain("is not an object, so `merge` did nothing");
  });
});

/**
 * `get` takes a `string | number`, so a key can come from data — and every write
 * ends in `copy[key] = value`. Refused in production too, which is why the
 * production suite asserts the same thing.
 */
describe("keys a write is refused for", () => {
  test("a write through __proto__ changes nothing and returns the original root", () => {
    const state: Record<string, unknown> = { a: 1 };
    const next = focusOn(state).get("__proto__").set({ polluted: true });

    expect(next).toBe(state);
    expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(warned.join("\n")).toContain('targets "__proto__"');
  });

  test("all three keys are refused, whichever operation aims at one", () => {
    const state: Record<string, unknown> = { a: 1 };

    for (const key of ["__proto__", "constructor", "prototype"] as const) {
      expect(focusOn(state).get(key).set(2)).toBe(state);
      expect(warned.join("\n")).toContain(`targets "${key}"`);
    }
  });

  test("a data-driven key mid-path is refused as well", () => {
    const state: { config: Record<string, unknown> } = { config: { theme: "dark" } };
    // What the guard is for: the key is not in the source, it is in the request.
    const fromRequest = "constructor";
    const next = focusOn(state).get("config").get(fromRequest).set(1);

    expect(next).toBe(state);
    expect(warned.join("\n")).toContain('.config.constructor targets "constructor"');
  });

  test("remove is refused too, rather than handing back a pointless copy", () => {
    const state: Record<string, unknown> = { a: 1 };
    const next = focusOn(state).get("__proto__").remove();

    // `"__proto__" in state` is true by inheritance, so without the guard this
    // deleted nothing and still returned a copy.
    expect(next).toBe(state);
    expect(warned.join("\n")).toContain('targets "__proto__"');
  });

  test("merge skips an unsafe key and writes the rest", () => {
    const state: { post: Record<string, unknown> } = { post: { id: 1 } };
    const payload = JSON.parse('{"title": "ok", "__proto__": {"polluted": true}}') as Record<string, unknown>;

    const next = focusOn(state).get("post").merge(payload);

    expect(next.post).toEqual({ id: 1, title: "ok" });
    expect(Object.getPrototypeOf(next.post)).toBe(Object.prototype);
    expect(warned.join("\n")).toContain('`merge` skipped "__proto__"');
  });

  test("an unsafe key NESTED inside a value is data, not an instruction", () => {
    // The guard is about keys a WRITE targets, and only the top level of a `merge` partial is
    // assigned key by key. A `__proto__` deeper than that is part of a value being stored, so
    // it is written as-is and nothing is polluted — worth pinning, because a guard that also
    // walked values would be both slower and wrong.
    const payload = JSON.parse('{"meta": {"__proto__": {"polluted": true}}}') as Record<string, unknown>;
    const state: { post: Record<string, unknown> } = { post: { id: 1 } };

    const result = focusOn(state).get("post").merge(payload);

    expect(result.post.meta).toBe(payload.meta);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(result.post)).toBe(Object.prototype);
    // Storing a value is not a refusal, so nothing is reported.
    expect(warned).toEqual([]);
  });

  test("`set` of a value carrying an unsafe key stores it whole", () => {
    const payload = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    const state: { config: unknown } = { config: null };

    const result = focusOn(state).get("config").set(payload);

    expect(result.config).toBe(payload);
    expect(warned).toEqual([]);
  });

  test("a merge of nothing but unsafe keys returns the original root", () => {
    const state: { post: Record<string, unknown> } = { post: { id: 1 } };
    const payload = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;

    expect(focusOn(state).get("post").merge(payload)).toBe(state);
  });
});

describe("remove", () => {
  test("drops a property from an object", () => {
    // Created first, deliberately: `draft` is optional and absent from the fixture,
    // so removing it straight away asserted nothing — `"draft" in post` was already
    // false, and the run took the "has no property" branch instead. The round trip
    // is what proves a removal happened.
    const state = focusOn(makeState()).get("posts").at(0).get("draft").set(true);
    expect(state.posts[0].draft).toBe(true);

    const next = focusOn(state).get("posts").at(0).get("draft").remove();

    expect("draft" in next.posts[0]).toBe(false);
    expect(next.posts[0].title).toBe("First post");
    expect(next.posts[1]).toBe(state.posts[1]);
    expect(warned).toEqual([]);
  });

  test("removing a property that is not there says so, and copies nothing", () => {
    const state = makeState();
    const next = focusOn(state).get("posts").at(0).get("draft").remove();

    expect(next).toBe(state);
    expect(warned.join("\n")).toContain('has no property "draft"');
  });

  test("drops an element by position", () => {
    const state = makeState();
    const next = focusOn(state).get("posts").at(0).remove();

    expect(next.posts).toHaveLength(1);
    expect(next.posts[0]).toBe(state.posts[1]);
  });

  test("drops every match at once", () => {
    const state: { posts: Post[] } = {
      posts: [
        { id: 1, title: "a", tags: [], draft: true },
        { id: 2, title: "b", tags: [] },
        { id: 3, title: "c", tags: [], draft: true },
      ],
    };

    const next = focusOn(state)
      .get("posts")
      .where((post) => post.draft === true)
      .remove();

    expect(next.posts.map((p) => p.id)).toEqual([2]);
    expect(next.posts[0]).toBe(state.posts[1]);
  });

  test("removing nothing returns the original root", () => {
    const state = makeState();
    const next = focusOn(state)
      .get("posts")
      .where((post) => post.id === 999)
      .remove();

    expect(next).toBe(state);
  });

  test("remove at the root throws, because there is no container", () => {
    expect(() => focusOn(makeState()).remove()).toThrow(/nothing to remove from/);
  });
});

describe("reading", () => {
  test("value returns the first match", () => {
    const state = makeState();
    expect(
      focusOn(state)
        .get("posts")
        .where((post) => post.id === 102)
        .get("title")
        .value(),
    ).toBe("Second post");
  });

  test("value on a path that resolves to nothing is undefined", () => {
    const state = makeState();
    expect(
      focusOn(state)
        .get("posts")
        .where((post) => post.id === 999)
        .get("title")
        .value(),
    ).toBeUndefined();
  });

  test("values returns every match", () => {
    const state = makeState();
    expect(focusOn(state).get("posts").where(Boolean).get("title").values()).toEqual(["First post", "Second post"]);
  });

  test("reading a missing path is silent — it is a fair question", () => {
    const state = makeState();
    focusOn(state)
      .get("posts")
      .where((post) => post.id === 999)
      .values();

    expect(warned).toEqual([]);
  });

  test("values flattens across two levels of where", () => {
    const state = makeState();
    expect(focusOn(state).get("posts").where(Boolean).get("tags").where(Boolean).values()).toEqual([
      "js",
      "web",
      "ssr",
      "draft",
    ]);
  });
});

/**
 * The chain is immutable — every hop returns a new instance — so sharing a
 * PREFIX is fine. What is not fine is a second write, because `focusOn` captured
 * the root once and the second result would silently lack the first edit.
 */
describe("chain reuse", () => {
  test("a prefix can be read from as many times as you like", () => {
    const state = makeState();
    const posts = focusOn(state).get("posts");

    expect(posts.where((p) => p.id === 101).value()?.title).toBe("First post");
    expect(posts.where((p) => p.id === 102).value()?.title).toBe("Second post");
    // `posts` focuses the ARRAY, so it is one value — the array itself.
    expect(posts.value()).toBe(state.posts);
  });

  test("a hop does not disturb the chain it grew from", () => {
    const state = makeState();
    const posts = focusOn(state).get("posts");
    posts.at(0).get("title");

    expect(posts.where(Boolean).values()).toHaveLength(2);
  });

  test("a second write through the same focusOn throws", () => {
    const state = makeState();
    const posts = focusOn(state).get("posts");

    posts.at(0).get("title").set("first edit");

    expect(() => posts.at(1).get("title").set("second edit")).toThrow(/already been written through/);
  });

  test("feeding the result back in is the supported way to chain edits", () => {
    const state = makeState();

    const afterFirst = focusOn(state).get("posts").at(0).get("title").set("one");
    const afterSecond = focusOn(afterFirst).get("posts").at(1).get("title").set("two");

    expect(afterSecond.posts.map((p) => p.title)).toEqual(["one", "two"]);
    // Still only the two edited posts are new; `users` rode through both walks.
    expect(afterSecond.users).toBe(state.users);
  });

  test("reads before and after a write do not trip the guard", () => {
    const state = makeState();
    const chain = focusOn(state).get("posts");

    expect(chain.where(Boolean).values()).toHaveLength(2);
    chain.at(0).get("title").set("x");
    expect(chain.where(Boolean).values()).toHaveLength(2);
  });
});

describe("class instances and exotic containers", () => {
  class Settings {
    constructor(
      public theme: string,
      public fontSize: number,
    ) {}
    describe(): string {
      return `${this.theme}/${this.fontSize}`;
    }
  }

  test("a copied node keeps its prototype", () => {
    const state = { settings: new Settings("dark", 14) };
    const next = focusOn(state).get("settings").get("theme").set("light");

    expect(next.settings).toBeInstanceOf(Settings);
    expect(next.settings.describe()).toBe("light/14");
    expect(next.settings).not.toBe(state.settings);
  });

  test("a getter stays a getter instead of being frozen into a value", () => {
    class Cart {
      items: number[] = [1, 2];
      label = "cart";
      get count(): number {
        return this.items.length;
      }
    }
    const state = { cart: new Cart() };
    const next = focusOn(state).get("cart").get("items").push(3);

    expect(next.cart.count).toBe(3);
  });

  test("a Map is fine as a value", () => {
    const map = new Map([["a", 1]]);
    const state: { data: Map<string, number> | null } = { data: null };
    const next = focusOn(state).get("data").set(map);

    expect(next.data).toBe(map);
  });

  test("descending INTO a Map is refused rather than silently broken", () => {
    const state = { data: new Map([["a", 1]]) };
    const next = focusOn(state).get("data").get("size").set(9);

    expect(next).toBe(state);
    expect(warned.join("\n")).toContain("Map");
  });
});

describe("missing paths", () => {
  test("a missing property MID-PATH changes nothing and names the hop", () => {
    const state = makeState();
    const next = focusOn(state as unknown as { nope: { deep: number } })
      .get("nope")
      .get("deep")
      .set(1);

    expect(next).toBe(state);
    expect(warned.join("\n")).toContain(".nope is undefined");
    expect(warned.join("\n")).toContain("could not be reached");
  });

  test("setting an ABSENT key at the end CREATES it", () => {
    // `draft?: boolean` is a key TypeScript accepts, so refusing it at runtime
    // made the API disagree with its own types — and with `merge`, which added
    // the very same field. Both spellings now do the same thing.
    const state: { post: { id: number; draft?: boolean } } = { post: { id: 1 } };

    const viaSet = focusOn(state).get("post").get("draft").set(true);
    expect(viaSet.post).toEqual({ id: 1, draft: true });
    expect(viaSet).not.toBe(state);

    const viaMerge = focusOn(state).get("post").merge({ draft: true });
    expect(viaMerge.post).toEqual({ id: 1, draft: true });

    // Creating a key is a real change, so nothing is reported.
    expect(warned).toEqual([]);
  });

  test("creating a key still shares everything off the path", () => {
    const state = makeState();
    const next = focusOn(state).get("posts").at(1).get("draft").set(true);

    expect(next.posts[1].draft).toBe(true);
    expect(next.posts[0]).toBe(state.posts[0]);
    expect(next.users).toBe(state.users);
    expect(next.posts[1].tags).toBe(state.posts[1].tags);
  });

  test("a null on the path changes nothing and says so", () => {
    const state: { profile: { name: string } | null } = { profile: null };
    const next = focusOn(state).get("profile").get("name").set("x");

    expect(next).toBe(state);
    expect(warned.join("\n")).toContain("could not be reached");
  });
});

/**
 * The record this package hands a collector — the protocol, asserted rather than
 * described.
 *
 * A written contract is the one thing in this repository with no tripwire behind
 * it, and it would rot the way every hand-maintained copy does: nothing stops a
 * `severity: "warning"` where the shape says `"warn"`, and no reviewer catches it
 * twice. So the shape is checked here, and the code registry is checked by the
 * docs' `check-api-coverage.mjs`, which fails the build when a code has no section
 * in the reference.
 *
 * See https://ramonda.pages.dev/reference/diagnostics#capturing-them.
 */
describe("the diagnostic record", () => {
  const SEVERITIES = ["debug", "info", "warn", "error"];

  test("every field is the shape the protocol names", () => {
    const state = makeState();
    focusOn(state)
      .get("posts")
      .where((post) => post.id === 999)
      .get("title")
      .set("x");

    expect(records).toHaveLength(1);
    const record = records[0];

    expect(record.code).toMatch(/^RML\d{3}$/);
    expect(record.scope).toBe("ramonda/lens");
    expect(SEVERITIES).toContain(record.severity);
    expect(typeof record.message).toBe("string");
    expect(typeof record.fix).toBe("string");
    expect(typeof record.time).toBe("number");
    // Sortable and comparable, not a locale-formatted string.
    expect(record.time).toBeGreaterThan(1_700_000_000_000);
    // Nothing here deduplicates, so nothing here claims a dedup key.
    expect(record.dedupKey).toBeUndefined();
  });

  test("`data` carries the values the message interpolated", () => {
    const state = makeState();
    focusOn(state).get("posts").at(9).get("title").set("x");

    expect(records[0].data).toEqual({ path: ".posts", operation: "at", index: 9, length: 2 });
  });

  test("`data` holds values, never live objects", () => {
    const state = makeState();

    // A collector keeps a bounded history. A record holding a component, a DOM
    // node or a piece of the state tree would keep it alive for as long as that
    // history does, which is a leak that only shows up in a long session.
    focusOn(state).get("posts").at(9).get("title").set("x");
    focusOn(state)
      .get("posts")
      .where(() => false)
      .set(state.posts[0]);
    focusOn(state)
      .get("data" as "posts")
      .merge({ x: 1 } as never);

    for (const record of records) {
      for (const value of Object.values(record.data ?? {})) {
        expect(["string", "number", "boolean", "undefined"]).toContain(typeof value);
      }
    }
  });

  test("a report reaches the console even with no collector installed", () => {
    globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
    focusOn(makeState()).get("posts").at(9).get("title").set("x");

    expect(warned.join("\n")).toContain("out of range");
    expect(records).toEqual([]);
  });

  test("every code carries a fix, and an error always does", () => {
    const state = makeState();
    const loose = (value: unknown) => value as never;

    // One of each severity path, so the assertion is over real records rather
    // than over the table they came from.
    focusOn(state).get("posts").at(9).set(loose(1));
    focusOn(state).get("posts").at(0).get(loose("__proto__")).set(loose(1));
    focusOn(state)
      .get("posts")
      .where(() => false)
      .set(loose(1));

    expect(codes()).toEqual(["RML004", "RML009", "RML005"]);
    for (const record of records) {
      if (record.severity === "error") expect(record.fix).toBeTruthy();
      expect(record.message.endsWith(" ")).toBe(false);
    }
  });
});

/**
 * Every code in the registry, raised — and every record it produces, checked against the
 * rules the protocol states rather than against the one case a test happened to pick.
 *
 * The completeness half is what a per-case test cannot give: a code declared and never
 * reachable is a section in the reference for something that cannot happen, and a code
 * reachable but never asserted is a message nobody has read since it was written.
 */
describe("the whole registry", () => {
  const loose = (value: unknown) => value as never;

  /** One of each fault class, in code order, so a gap in the set names itself. */
  function raiseEverything(): void {
    // RML001 — a hop before the last one holds nothing.
    focusOn({} as { a?: { b: number } })
      .get("a")
      .get("b")
      .set(1);
    // RML002 — a path into an exotic container.
    focusOn({ data: new Map([["a", 1]]) })
      .get("data")
      .get(loose("size"))
      .set(loose(9));
    // RML003 — an array hop on something that is not an array. It has to be an OBJECT: `at`
    // on a primitive never reaches the array check, because a primitive is not a container
    // and the walk reports RML001 one step earlier.
    focusOn(loose({ a: { b: 1 } }))
      .get("a")
      .at(0)
      .set(loose(1));
    // RML004 — an index outside the array.
    focusOn({ list: [1] })
      .get("list")
      .at(9)
      .set(2);
    // RML005 — a predicate that matched nothing.
    focusOn({ list: [1] })
      .get("list")
      .where(() => false)
      .set(2);
    // RML006 — an operation that needs a different kind of value.
    focusOn({ count: 1 } as unknown as { count: number[] })
      .get("count")
      .push(1);
    // RML007 — nothing to remove.
    focusOn({ a: 1 } as { a: number; gone?: number })
      .get("gone")
      .remove();
    // RML008 — a fork branch that returned nothing.
    focusOn({ a: { b: 1 } })
      .get("a")
      .and(loose(() => undefined));
    // RML009 — a key a write is refused for.
    focusOn({} as Record<string, unknown>)
      .get("__proto__")
      .set(1);
    // RML010 — a chain written through twice.
    const chain = focusOn({ list: [1, 2] }).get("list");
    chain.at(0).set(9);
    expect(() => chain.at(1).set(9)).toThrow();
    // RML011 — remove at the root.
    expect(() => focusOn({ a: 1 }).remove()).toThrow();
  }

  test("every code the registry declares is reachable", () => {
    raiseEverything();

    const raised = [...new Set(codes())].sort();
    expect(raised).toEqual([
      "RML001",
      "RML002",
      "RML003",
      "RML004",
      "RML005",
      "RML006",
      "RML007",
      "RML008",
      "RML009",
      "RML010",
      "RML011",
    ]);
  });

  test("every record obeys the protocol, not just the ones a test picked", () => {
    raiseEverything();
    expect(records.length).toBeGreaterThanOrEqual(11);

    for (const record of records) {
      expect(record.code).toMatch(/^RML\d{3}$/);
      expect(record.scope).toBe("ramonda/lens");
      expect(["debug", "info", "warn", "error"]).toContain(record.severity);
      // A message that is empty, or that trails off, is one nobody proof-read.
      expect(record.message.length).toBeGreaterThan(10);
      expect(record.message.trim()).toBe(record.message);
      expect(record.time).toBeGreaterThan(1_700_000_000_000);
      // Nothing here deduplicates, so nothing may claim a key for it.
      expect(record.dedupKey).toBeUndefined();
      // An `error` promises a fix. The type enforces it; this proves the type is doing so
      // over real records rather than over the table they were read from.
      if (record.severity === "error") expect(record.fix?.length ?? 0).toBeGreaterThan(20);
      // `data` carries values a collector can hold for as long as it likes.
      for (const value of Object.values(record.data ?? {})) {
        expect(["string", "number", "boolean"]).toContain(typeof value);
      }
      // Every record names where it happened, which is the one field every message shares.
      expect(typeof record.data?.path).toBe("string");
    }
  });

  test("what is printed and what is thrown say the same thing", () => {
    // Two spellings of one fault would drift the moment either is edited, and the throw is
    // the one a developer reads in a stack trace.
    let thrown = "";
    try {
      focusOn({ a: 1 }).remove();
    } catch (error) {
      thrown = (error as Error).message;
    }

    expect(warned).toHaveLength(1);
    expect(thrown).toBe(warned[0]);
    expect(thrown).toContain("[Ramonda lens RML011]");
    expect(thrown).toContain("→ ");
  });
});

/**
 * Every message the docs page promises, triggered once.
 *
 * The page maps each string to its cause, and a reader searches for the part they
 * saw — so the strings are documentation, and a silent edit to one leaves the page
 * describing a message nobody will ever get. This is what makes that a test failure.
 *
 * Several of these are unreachable from TypeScript: the types refuse `at` on
 * something that is not an array. They are reachable from JavaScript, which is who
 * the runtime check is for, so they are provoked through a cast.
 */
describe("the documented messages", () => {
  /** What a JavaScript caller can pass and a TypeScript caller cannot. */
  const loose = (value: unknown) => value as never;

  /**
   * A focus with the types switched off, for the hops TypeScript refuses outright:
   * `at` and `where` are not even present on a focus that is not an array, so there
   * is no argument to cast — the whole chain has to be untyped.
   */
  const anyFocus = (value: unknown) => focusOn(loose(value));

  const trigger = (fn: () => unknown): string => {
    warned = [];
    records = [];
    fn();
    return warned.join("\n");
  };

  test("a primitive mid-path is named with its value", () => {
    const state = makeState();
    expect(trigger(() => focusOn(state).get("posts").at(0).get("title").get(loose("length")).set(loose(1)))).toContain(
      'is "First post", so .posts[0].title.length could not be reached',
    );
  });

  test("the array hops on something that is not an array", () => {
    const state = makeState();

    expect(trigger(() => anyFocus(state).get("users").at(0).at(0).set(loose(1)))).toContain(
      "is not an array, so `at` cannot be used",
    );
    expect(
      trigger(() =>
        anyFocus(state)
          .get("users")
          .at(0)
          .where(() => true)
          .set(loose(1)),
      ),
    ).toContain("is not an array, so `where` cannot be used");
    expect(trigger(() => anyFocus(state).get("users").at(0).insert(0, loose(1)))).toContain(
      "is not an array, so `insert` did nothing",
    );
  });

  test("the remove variants", () => {
    const state = makeState();

    expect(trigger(() => focusOn(state).get("posts").at(0).get("title").get(loose("length")).remove())).toContain(
      "is not a container, so there is nothing to remove from",
    );
    expect(trigger(() => focusOn(state).get("posts").at(0).get(loose("nope")).remove())).toContain(
      'has no property "nope", so nothing was removed',
    );
    expect(trigger(() => anyFocus(state).get("users").at(0).at(0).remove())).toContain(
      "is not an array, so `at(…).remove()` cannot be used",
    );
    expect(trigger(() => focusOn(state).get("posts").at(9).remove())).toContain(
      "has 2 element(s), so index 9 cannot be removed",
    );
    expect(
      trigger(() =>
        anyFocus(state)
          .get("users")
          .at(0)
          .where(() => true)
          .remove(),
      ),
    ).toContain("is not an array, so `where(…).remove()` cannot be used");
  });

  test("every one of them is prefixed, and no read produces any", () => {
    const state = makeState();

    const message = trigger(() => focusOn(state).get("posts").at(9).get("title").set("x"));
    expect(message).toMatch(/^\[Ramonda lens RML\d{3}] /);

    expect(trigger(() => focusOn(state).get("posts").at(9).get("title").value())).toBe("");
  });
});

describe("depth", () => {
  test("two dimensions", () => {
    const state = {
      grid: [
        [
          { id: "a", n: 1 },
          { id: "b", n: 2 },
        ],
        [
          { id: "c", n: 3 },
          { id: "d", n: 4 },
        ],
      ],
    };

    const next = focusOn(state)
      .get("grid")
      .where(Boolean)
      .where((cell) => cell.n % 2 === 0)
      .get("n")
      .update((n) => n * 10);

    expect(next.grid.map((row) => row.map((c) => c.n))).toEqual([
      [1, 20],
      [3, 40],
    ]);

    // Row 0 and row 1 each had one edit, so both rows are new — but the cells
    // that did not match are the same objects.
    expect(next.grid[0][0]).toBe(state.grid[0][0]);
    expect(next.grid[1][0]).toBe(state.grid[1][0]);
    expect(next.grid[0]).not.toBe(state.grid[0]);
  });

  test("a row that matched nothing keeps its identity", () => {
    const state = {
      grid: [
        [{ id: "a", n: 1 }],
        [
          { id: "b", n: 2 },
          { id: "c", n: 4 },
        ],
      ],
    };

    const next = focusOn(state)
      .get("grid")
      .where(Boolean)
      .where((cell) => cell.n % 2 === 0)
      .get("n")
      .set(0);

    expect(next.grid[0]).toBe(state.grid[0]);
    expect(next.grid[1]).not.toBe(state.grid[1]);
  });
});

/**
 * Forking a path — the one thing immer could do that a single chain could not:
 * touch several places in one pass.
 */
describe("and — several paths, one walk", () => {
  test("each branch walks on from the forked value", () => {
    const state = makeState();

    const next = focusOn(state)
      .get("posts")
      .where((post) => post.id === 102)
      .and(
        (post) => post.get("title").set("Renamed"),
        (post) => post.get("tags").push("published"),
      );

    expect(next.posts[1]).toEqual({
      id: 102,
      title: "Renamed",
      tags: ["ssr", "draft", "published"],
    });
    expect(next.posts[0]).toBe(state.posts[0]);
  });

  test("the prefix is copied ONCE, not once per branch", () => {
    // Both shapes produce an equal object, so equality proves nothing. What
    // differs is how many times the tree ABOVE the fork gets rebuilt.
    //
    // A counting getter on the root was tried first and does not work: the very
    // first shallow copy spreads the getter into a plain value, so it stops
    // counting after one chain and reported 2 vs 2. Counting the distinct array
    // objects that actually exist survives copying, because that is the thing
    // being allocated.
    const seed = (): { users: { id: number }[]; posts: Post[] } => ({
      users: [{ id: 1 }],
      posts: [
        { id: 1, title: "a", tags: [] },
        { id: 2, title: "b", tags: [] },
      ],
    });

    const viaAndStart = seed();
    const viaAnd = focusOn(viaAndStart)
      .get("posts")
      .at(1)
      .and(
        (post) => post.get("title").set("A"),
        (post) => post.get("draft").set(true),
        (post) => post.get("tags").push("c"),
      );

    // The same three edits the only way that was possible before `and`.
    const chainStart = seed();
    const first = focusOn(chainStart).get("posts").at(1).get("title").set("A");
    const second = focusOn(first).get("posts").at(1).get("draft").set(true);
    const third = focusOn(second).get("posts").at(1).get("tags").push("c");

    // Same result either way.
    expect(viaAnd.posts[1]).toEqual({ id: 2, title: "A", tags: ["c"], draft: true });
    expect(third.posts[1]).toEqual(viaAnd.posts[1]);

    const distinct = (...values: unknown[]) => new Set(values).size;

    // Three chains rebuild the root and the `posts` array once per edit, and
    // throw two of each away. `and` builds one of each.
    expect(distinct(chainStart, first, second, third)).toBe(4);
    expect(distinct(chainStart.posts, first.posts, second.posts, third.posts)).toBe(4);

    expect(distinct(viaAndStart, viaAnd)).toBe(2);
    expect(distinct(viaAndStart.posts, viaAnd.posts)).toBe(2);

    // And the untouched sibling rode through both, uncopied.
    expect(viaAnd.users).toBe(viaAndStart.users);
    expect(third.users).toBe(chainStart.users);
  });

  test("branches run in order, and each sees the previous one's result", () => {
    const state = { counter: { n: 1 } };

    const next = focusOn(state)
      .get("counter")
      .and(
        (c) => c.get("n").update((n) => n + 1),
        (c) => c.get("n").update((n) => n * 10),
      );

    // 1 -> 2 -> 20. Applied to the original in parallel, one would have won.
    expect(next.counter.n).toBe(20);
  });

  test("forking at the root reaches unrelated branches of the tree", () => {
    const state = makeState();

    const next = focusOn(state).and(
      (s) => s.get("users").at(0).get("name").set("Renamed"),
      (s) => s.get("posts").at(0).get("title").set("First"),
    );

    expect(next.users[0].name).toBe("Renamed");
    expect(next.posts[0].title).toBe("First");
    // The branch each did not touch is untouched.
    expect(next.posts[1]).toBe(state.posts[1]);
    expect(next.users[0]).not.toBe(state.users[0]);
  });

  test("a fork under `where` applies to every match", () => {
    const state: { posts: Post[] } = {
      posts: [
        { id: 1, title: "a", tags: [], draft: true },
        { id: 2, title: "b", tags: [] },
        { id: 3, title: "c", tags: [], draft: true },
      ],
    };

    const next = focusOn(state)
      .get("posts")
      .where((post) => post.draft === true)
      .and(
        (post) => post.get("title").set("TODO"),
        (post) => post.get("tags").push("wip"),
      );

    expect(next.posts.map((p) => [p.title, p.tags.join()])).toEqual([
      ["TODO", "wip"],
      ["b", ""],
      ["TODO", "wip"],
    ]);
    expect(next.posts[1]).toBe(state.posts[1]);
  });

  test("branches that change nothing return the original root", () => {
    const state = makeState();
    const next = focusOn(state)
      .get("posts")
      .at(0)
      .and(
        (post) => post.get("title").set("First post"),
        (post) => post.get("id").set(101),
      );

    expect(next).toBe(state);
  });

  test("no branches is a no-op", () => {
    const state = makeState();
    expect(focusOn(state).get("posts").and()).toBe(state);
  });

  test("a branch that forgets to return is reported and skipped", () => {
    const state = makeState();

    const next = focusOn(state)
      .get("posts")
      .at(0)
      .and(
        // The obvious mistake with a callback API: a block body and no return.
        ((post: { get: (k: string) => { set: (v: string) => unknown } }) => {
          post.get("title").set("dropped");
        }) as never,
        (post) => post.get("title").set("kept"),
      );

    expect(next.posts[0].title).toBe("kept");
    expect(warned.join("\n")).toContain("a branch returned undefined");
  });

  test("forks nest", () => {
    const state = makeState();

    const next = focusOn(state)
      .get("posts")
      .at(1)
      .and(
        (post) => post.get("title").set("Outer"),
        (post) =>
          post.get("tags").and(
            (tags) => tags.push("x"),
            (tags) => tags.at(0).set("FIRST"),
          ),
      );

    expect(next.posts[1].title).toBe("Outer");
    expect(next.posts[1].tags).toEqual(["FIRST", "draft", "x"]);
  });
});
