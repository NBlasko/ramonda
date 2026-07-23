/**
 * focusOn vs immer.
 *
 * Run: node bench/against-immer.mjs
 *
 * Measured against the PRODUCTION build (`dist/index.prod.js`), so the DEV
 * diagnostics and the reuse guard are compiled out — the same code a user ships.
 *
 * Two things this harness does on purpose, because the first version of it lied:
 *
 * 1. TRIALS ARE INTERLEAVED and the median is reported. Running each contender
 *    to completion in turn made immer look 13x slower on the smallest state and
 *    3x slower on a state ten times bigger — the opposite of how cost scales.
 *    That was the JIT: whoever ran first paid to compile the other's code paths
 *    too. Alternating and taking the median removes it.
 *
 * 2. TWO SHAPES ARE MEASURED, not one. A path through a big array is dominated
 *    by the O(n) scan and the O(n) array copy, which BOTH libraries have to pay
 *    — so it measures the array, not the technique. The deep-object path is what
 *    isolates the difference the design is actually about.
 */
import { produce, setAutoFreeze } from "immer";
import { focusOn } from "../dist/index.prod.js";

const TRIALS = 7;
const ROUNDS = 2000;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Runs every contender TRIALS times, alternating, and reports each one's median.
 * `contenders` is `{ label -> fn }`; every fn must produce the same result.
 */
function compare(title, contenders, verify) {
  const labels = Object.keys(contenders);

  for (const label of labels) verify(contenders[label]());
  for (const label of labels) {
    for (let i = 0; i < 500; i++) contenders[label]();
  }

  const samples = Object.fromEntries(labels.map((label) => [label, []]));

  for (let trial = 0; trial < TRIALS; trial++) {
    for (const label of labels) {
      const fn = contenders[label];
      const started = process.hrtime.bigint();
      for (let i = 0; i < ROUNDS; i++) fn();
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
      samples[label].push((elapsed / ROUNDS) * 1000);
    }
  }

  console.log(`\n${title}`);
  const baseline = median(samples[labels[0]]);
  for (const label of labels) {
    const perOp = median(samples[label]);
    console.log(
      `  ${label.padEnd(32)} ${perOp.toFixed(2).padStart(9)} µs/op   ` +
        `${(perOp / baseline).toFixed(2).padStart(6)}x`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Shape 1: a path through a large array.
 * ------------------------------------------------------------------ */

function makeWideState(postCount, tagCount) {
  return {
    users: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `user${i}` })),
    posts: Array.from({ length: postCount }, (_, i) => ({
      id: i,
      title: `Post ${i}`,
      body: "x".repeat(200),
      tags: Array.from({ length: tagCount }, (_, t) => `tag${t}`),
    })),
  };
}

function runWide(postCount, tagCount) {
  const state = makeWideState(postCount, tagCount);
  const target = Math.floor(postCount / 2);

  const verify = (next) => {
    if (next.posts[target].tags[3] !== "EDITED") throw new Error("edit did not land");
    if (next.users !== state.users) throw new Error("untouched branch was copied");
    if (next.posts[0] !== state.posts[0]) throw new Error("untouched post was copied");
    if (state.posts[target].tags[3] === "EDITED") throw new Error("input was mutated");
  };

  setAutoFreeze(false);
  compare(
    `array path — ${postCount} posts x ${tagCount} tags, one deep edit`,
    {
      focusOn: () =>
        focusOn(state)
          .get("posts")
          .where((p) => p.id === target)
          .get("tags")
          .at(3)
          .set("EDITED"),
      // What a person naturally writes: find the record, then edit it.
      "immer (.find)": () =>
        produce(state, (draft) => {
          draft.posts.find((p) => p.id === target).tags[3] = "EDITED";
        }),
      // immer at its best, and the honest control: when the index is already
      // known, nothing is scanned and exactly one element is ever drafted. Any
      // gap between this row and the one above is the cost of scanning THROUGH
      // the proxy, not the cost of immer.
      "immer (index known)": () =>
        produce(state, (draft) => {
          draft.posts[target].tags[3] = "EDITED";
        }),
      // The same courtesy for us: skip the predicate when the index is known.
      "focusOn (index known)": () => focusOn(state).get("posts").at(target).get("tags").at(3).set("EDITED"),
    },
    verify,
  );
}

/* ------------------------------------------------------------------ *
 * Shape 2: a deep path through objects, no scan and no big copy.
 * ------------------------------------------------------------------ */

function makeDeepState(width) {
  const leaf = (prefix) => Object.fromEntries(Array.from({ length: width }, (_, i) => [`${prefix}${i}`, i]));

  return {
    app: {
      settings: {
        editor: {
          appearance: { theme: "dark", fontSize: 14, ...leaf("a") },
          keymap: leaf("k"),
        },
        terminal: leaf("t"),
      },
      workspace: leaf("w"),
    },
    session: leaf("s"),
  };
}

function runDeep(width) {
  const state = makeDeepState(width);

  const verify = (next) => {
    if (next.app.settings.editor.appearance.theme !== "light") throw new Error("edit did not land");
    if (next.session !== state.session) throw new Error("untouched branch was copied");
    if (next.app.workspace !== state.app.workspace) throw new Error("untouched branch was copied");
    if (state.app.settings.editor.appearance.theme === "light") throw new Error("input mutated");
  };

  setAutoFreeze(false);
  compare(
    `object path — 5 levels deep, ${width} sibling keys per level`,
    {
      focusOn: () =>
        focusOn(state).get("app").get("settings").get("editor").get("appearance").get("theme").set("light"),
      immer: () =>
        produce(state, (draft) => {
          draft.app.settings.editor.appearance.theme = "light";
        }),
    },
    verify,
  );
}

/* ------------------------------------------------------------------ *
 * Shape 3: SEVERAL edits in one pass — what immer's producer does natively
 * and a single chain could not do at all before `and`.
 * ------------------------------------------------------------------ */

function runMulti(postCount) {
  const state = makeWideState(postCount, 10);
  const target = Math.floor(postCount / 2);

  const verify = (next) => {
    const post = next.posts[target];
    if (post.title !== "A" || post.draft !== true || post.tags.at(-1) !== "c") {
      throw new Error("edits did not all land");
    }
    if (next.users !== state.users) throw new Error("untouched branch was copied");
    if (state.posts[target].title === "A") throw new Error("input was mutated");
  };

  setAutoFreeze(false);
  compare(
    `three edits to one record — ${postCount} posts`,
    {
      "focusOn .and": () =>
        focusOn(state)
          .get("posts")
          .at(target)
          .and(
            (post) => post.get("title").set("A"),
            (post) => post.get("draft").set(true),
            (post) => post.get("tags").push("c"),
          ),
      // What it took before `and`: one chain per edit, each re-walking and
      // re-copying the whole prefix.
      "focusOn x3 chains": () => {
        let next = focusOn(state).get("posts").at(target).get("title").set("A");
        next = focusOn(next).get("posts").at(target).get("draft").set(true);
        return focusOn(next).get("posts").at(target).get("tags").push("c");
      },
      immer: () =>
        produce(state, (draft) => {
          const post = draft.posts[target];
          post.title = "A";
          post.draft = true;
          post.tags.push("c");
        }),
    },
    verify,
  );
}

runMulti(1000);
runMulti(5000);

runDeep(10);
runDeep(100);
runWide(100, 10);
runWide(1000, 10);
runWide(5000, 20);
