import { describe, expect, test } from "vitest";
import { focusOn } from "../../index";

/**
 * The production path: every warning stripped, every write still correct.
 *
 * Written for the first release of this package, because until then nothing had ever run its production
 * code: the ordinary suite pins `__DEV__` true, so `apply.ts` — which is half `if (__DEV__) warn(…)` —
 * was only ever exercised in the shape apps do not ship.
 *
 * What this suite asserts is the CONTRACT, not the guards, and that is a finding rather than a
 * preference. I tried to break it the obvious way — moving an early `return` inside a `__DEV__` block, so
 * production would fall through where development stops — and production behaved identically, because
 * every warned-about path in `apply.ts` is backed by a second, non-dev guard that catches the same case
 * (`at` on a non-array falls through to an index resolve that reports NOT_FOUND and hands the node back
 * anyway). So there is no production-only regression to catch there, and a test pretending otherwise
 * would be passing for the wrong reason.
 *
 * What IS worth asserting is what a caller is promised: a write lands, everything untouched keeps its
 * identity, and a path that goes nowhere returns the original root — the same object, not a copy.
 *
 * See `vitest.prod.config.ts` for why this is a separate process.
 */

interface Post {
  id: number;
  tags: string[];
  meta: { seen: boolean };
}
interface State {
  posts: Post[];
  settings: { theme: { mode: string } };
}

const make = (): State => ({
  posts: [
    { id: 101, tags: ["a"], meta: { seen: false } },
    { id: 102, tags: ["draft", "b"], meta: { seen: false } },
  ],
  settings: { theme: { mode: "light" } },
});

describe("the production build", () => {
  // If this were false the whole file would be testing the development path, which the ordinary suite
  // already covers — the assertion is what makes the rest of the file mean anything.
  test("__DEV__ is false in this run", () => {
    expect(__DEV__).toBe(false);
  });

  test("writes through a matched element, and shares what it did not touch", () => {
    const state = make();
    const next = focusOn(state)
      .get("posts")
      .where((post) => post.id === 102)
      .get("tags")
      .set(["kept"]);

    expect(next.posts[1]!.tags).toEqual(["kept"]);
    expect(state.posts[1]!.tags).toEqual(["draft", "b"]);
    // Structural sharing is the whole point, and it is not a development-only nicety.
    expect(next.posts[0]).toBe(state.posts[0]);
    expect(next.settings).toBe(state.settings);
  });

  test("writes deep by key, and by index", () => {
    const state = make();

    expect(focusOn(state).get("settings").get("theme").get("mode").set("dark").settings.theme.mode).toBe("dark");
    expect(focusOn(state).get("posts").at(0).get("meta").get("seen").set(true).posts[0]!.meta.seen).toBe(true);
    expect(state.settings.theme.mode).toBe("light");
  });

  test("removes", () => {
    const state = make();
    expect(focusOn(state).get("posts").at(0).remove().posts).toHaveLength(1);
    expect(state.posts).toHaveLength(2);
  });

  test("forks a path with and(), several edits in one walk", () => {
    const state = make();
    const next = focusOn(state).and(
      (root) => root.get("posts").at(0).get("meta").get("seen").set(true),
      (root) => root.get("settings").get("theme").get("mode").set("dark"),
    );

    expect(next.posts[0]!.meta.seen).toBe(true);
    expect(next.settings.theme.mode).toBe("dark");
  });

  /**
   * The case this file was written for. In development each of these WARNS and changes nothing; in
   * production the warning is gone, and what must remain is the "changes nothing" — not a throw, and not
   * a silent write to the wrong place.
   */
  /**
   * In development each of these WARNS and changes nothing. In production the warning is gone and what
   * must remain is the "changes nothing" — asserted as IDENTITY, because that is the actual promise: no
   * copy at all, the original root handed straight back. "Does not throw" was the first version of this
   * assertion, and it was too weak to distinguish anything: the mutation above passed it.
   */
  test("a path that goes nowhere returns the original root, not a copy", () => {
    const state = make();

    /**
     * Cast through `unknown`, and the cast is the good news: the types REFUSE `at` and `where` on
     * something that is not an array, so a TypeScript caller cannot write these lines at all. They are
     * here for the runtime, which a plain JavaScript caller can still reach — and which is what the
     * stripped warnings used to be the only answer to.
     */
    const loose = (value: unknown) => value as never;

    // Five ways to aim at nothing: a key that is not there, `at` and `where` on something that is not an
    // array, a `where` that matches nothing, and an index past the end.
    expect(focusOn(loose(state)).get(loose("nope")).get(loose("deeper")).set(loose(1))).toBe(state);
    expect(focusOn(loose(state)).get(loose("settings")).at(0).set(loose({}))).toBe(state);
    expect(
      focusOn(loose(state))
        .get(loose("settings"))
        .where(() => true)
        .set(loose({})),
    ).toBe(state);
    expect(
      focusOn(state)
        .get("posts")
        .where((post) => post.id === 999)
        .get("tags")
        .set([]),
    ).toBe(state);
    expect(focusOn(state).get("posts").at(9).get("tags").set([])).toBe(state);

    expect(state).toEqual(make());
  });
});
