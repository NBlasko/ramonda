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
      { id: 101, title: "Prvi post", tags: ["js", "web"] },
      { id: 102, title: "Drugi post", tags: ["ssr", "draft"] },
    ],
  };
}

let warned: string[] = [];
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warned = [];
  warnSpy = vi.spyOn(console, "warn").mockImplementation((message: unknown) => {
    warned.push(String(message));
  });
});

afterEach(() => {
  warnSpy.mockRestore();
});

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
        { id: 101, title: "Prvi post", tags: ["js", "web"] },
        { id: 102, title: "Drugi post", tags: ["ssr", "published"] },
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
      .set("Drugi post");

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
    const next = focusOn(state).get("posts").at(0).merge({ title: "Prvi post" });

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
});

describe("remove", () => {
  test("drops a property from an object", () => {
    const state = makeState();
    const next = focusOn(state).get("posts").at(0).get("draft").remove();

    expect("draft" in next.posts[0]).toBe(false);
    expect(next.posts[1]).toBe(state.posts[1]);
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
    ).toBe("Drugi post");
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
    expect(focusOn(state).get("posts").where(Boolean).get("title").values()).toEqual(["Prvi post", "Drugi post"]);
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

    expect(posts.where((p) => p.id === 101).value()?.title).toBe("Prvi post");
    expect(posts.where((p) => p.id === 102).value()?.title).toBe("Drugi post");
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
        (post) => post.get("title").set("Prvi post"),
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
