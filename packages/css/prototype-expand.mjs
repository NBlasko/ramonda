/**
 * Splitting a shorthand into its longhands, taught and checked by the engines.
 *
 *     node prototype-expand.mjs
 *
 * ## What this is for
 *
 * If every declaration a block emits is a LONGHAND, no two classes on an element set the same
 * property, `mergeClassNames` settles every conflict by key, and the cascade is never asked — which
 * removes the cross-version layer problem entirely (see `DESIGN.md`, "A published package meets an
 * application"). Splitting is what makes that true. This measures how much of it one probe can
 * learn without a rule being written down anywhere.
 *
 * ## Three shapes, tried in order
 *
 * **POSITIONAL** — `padding: 10px 20px`. Which value a longhand takes depends on how many were
 * written. 25 families.
 *
 * **BY TYPE** — `border: 1px solid red`. Which longhand a token goes to depends on WHAT it is, not
 * where it sits, and the types land on disjoint sets of longhands. 14 families, the whole `border`
 * branch plus `outline`, `column-rule`, `columns`.
 *
 * **BY TYPE, THEN ORDER** — `flex: 1 1 0`, `animation: 1s 2s`. Two tokens of the SAME type go to
 * different longhands, and only their order says which. The type narrows it to a list of slots;
 * position within that list finishes the job.
 *
 * Each shape is learned the same way — by DIFFERENCING two probes. Two values of one type, fed to
 * the same family, and the longhands that change between them are that type's. Nothing is compared
 * against a literal, so an engine normalising `url(a.png)` into `url("a.png")` cannot be mistaken
 * for a mapping.
 *
 * ## Nothing about the rule is written here
 *
 * The first draft had a `1/2/3/4` table in it and a hand-written idea of which longhand is position
 * zero. Both are facts the engines already hold, and a third copy is the mistake
 * `build-shorthand-leaves.mjs` exists to stop making. So the shape is learned PER ARITY: the family
 * is fed distinct sentinels in each pattern it accepts, and whichever longhand comes back holding
 * sentinel *i* is position *i*. A longhand that comes back holding something that is not a sentinel
 * at all has a CONSTANT there, and that is recorded as the constant.
 *
 * Learning per arity is what made the awkward shapes fall out for free rather than being special
 * cases: `background-position: 1px` is `x: 1px, y: center` — not a repeat — and `border-radius`'s
 * `/` form pairs the two sides instead of filling four corners. Neither needed a rule of its own.
 *
 * ## Why the engines are also the ORACLE
 *
 * A splitter that is wrong changes a style silently. `element.style` expands a shorthand itself and
 * reading the longhands back gives the SPECIFIED values — not computed, so no resolution creeps in.
 * It is an exact answer for any value worth trying, in three engines, before anything ships. It has
 * already earned its place: the first run tore `rgb(1, 1, 1)` into three values, because the split
 * was on every space rather than on top-level ones.
 *
 * What it prints: how many families one learned rule covers in all three engines, and which values
 * defeat it — the second being the real output, because those are what needs a grammar of its own.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const pw = createRequire(join(HERE, "..", "..", "apps", "playground-core", "package.json"))("@playwright/test");
const { SHORTHANDS } = await import("./src/compiler/keywords.generated.ts");

/** Sentinel sets for the POSITIONAL shape — a family takes whichever one its grammar accepts. */
const DOMAINS = [
  {
    kind: "length",
    sentinels: ["1px", "2px", "3px", "4px", "5px", "6px", "7px", "8px"],
    corpus: ["0", "10px", "10%", "calc(1px + 2%)", "min(1px, 2%)", "-5px", "var(--x)", "inherit", "initial"],
  },
  {
    kind: "colour",
    sentinels: [
      "rgb(1, 1, 1)",
      "rgb(2, 2, 2)",
      "rgb(3, 3, 3)",
      "rgb(4, 4, 4)",
      "rgb(5, 5, 5)",
      "rgb(6, 6, 6)",
      "rgb(7, 7, 7)",
      "rgb(8, 8, 8)",
    ],
    corpus: ["red", "#abc", "rgb(1 2 3)", "color-mix(in srgb, red, blue)", "currentcolor", "var(--c)", "inherit"],
  },
  {
    kind: "line-style",
    sentinels: ["dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"],
    corpus: ["none", "solid", "double", "var(--s)", "inherit"],
  },
  {
    kind: "alignment",
    sentinels: ["start", "end", "center", "stretch", "flex-start", "flex-end", "baseline", "normal"],
    corpus: ["start", "end", "center", "stretch", "space-between", "normal", "var(--a)", "inherit"],
  },
  {
    kind: "corner-shape",
    sentinels: ["round", "bevel", "scoop", "notch", "square", "squircle"],
    corpus: ["round", "bevel", "scoop", "notch", "square", "var(--k)", "inherit"],
  },
  {
    kind: "white-space",
    sentinels: ["normal", "pre", "nowrap", "pre-wrap", "pre-line", "break-spaces", "collapse", "preserve"],
    corpus: ["normal", "pre", "nowrap", "balance", "pretty", "stable", "var(--w)", "inherit"],
  },
  {
    kind: "vertical-align",
    sentinels: ["baseline", "sub", "super", "top", "text-top", "middle", "bottom", "text-bottom"],
    corpus: ["baseline", "sub", "middle", "10px", "50%", "var(--v)", "inherit"],
  },
  {
    kind: "grid-line",
    sentinels: ["1", "2", "3", "4", "5", "6", "7", "8"],
    corpus: ["auto", "1", "-1", "span 2", "3", "var(--n)", "inherit"],
  },
  {
    kind: "overflow",
    sentinels: ["auto", "hidden", "clip", "scroll", "visible", "auto", "hidden", "clip"],
    corpus: ["visible", "auto", "clip", "var(--o)", "inherit"],
  },
];

/**
 * The value patterns the positional shape is taught, each as the length of every SLASH-SEPARATED
 * side.
 *
 * Two sides was enough for `border-radius`, where the slash splits one value into a horizontal and
 * a vertical half. `grid-area: 1 / 2 / 3 / 4` is four, and they are four independent slots rather
 * than halves of anything — so the pattern is a list rather than a flag, and the key is written the
 * way the value is.
 */
const PATTERNS = [[1], [2], [3], [4], [1, 1], [2, 2], [4, 4], [2, 1], [1, 2], [1, 1, 1], [1, 1, 1, 1]].map((sides) => ({
  key: sides.join("/"),
  sides,
  slots: sides.reduce((sum, one) => sum + one, 0),
}));

/**
 * Corpora for the TYPE shapes, one token list per component type.
 *
 * Two of each, because the mapping is learned by DIFFERENCING: feed the family one, then the other,
 * and the longhands that changed between them belong to that type. Comparing against the literal
 * instead reads an engine normalising `url(a.png)` into `url("a.png")` as a missing mapping.
 */
const TYPES = {
  length: ["3px", "9px"],
  colour: ["rgb(1, 2, 3)", "rgb(4, 5, 6)"],
  "line-style": ["dashed", "dotted"],
  number: ["7", "11"],
  time: ["1.5s", "2.5s"],
  easing: ["ease-in", "ease-out"],
  ident: ["aaa", "bbb"],
  percent: ["37%", "61%"],
  image: ["url(a.png)", "url(b.png)"],
};

/** In the page: set a declaration and read the longhands it expanded into. */
function expandIn(name, value) {
  const el = document.getElementById("x");
  el.style.cssText = "";
  el.style.setProperty(name, value);
  const out = {};
  for (let i = 0; i < el.style.length; i++) {
    const one = el.style[i];
    if (one !== name) out[one] = el.style.getPropertyValue(one);
  }
  return out;
}

/** What the page RENDERS: the shorthand on one element, our split longhands on the other. */
function computedIn(name, value, mine, longhands) {
  const a = document.getElementById("x");
  const b = document.getElementById("y");
  a.style.cssText = "";
  b.style.cssText = "";
  a.style.setProperty(name, value);
  for (const [one, held] of Object.entries(mine ?? {})) b.style.setProperty(one, held);
  const read = (el) => longhands.map((one) => getComputedStyle(el).getPropertyValue(one)).join(" | ");
  return [read(a), read(b)];
}

const names = Object.keys(SHORTHANDS).filter((one) => !one.startsWith("-"));
const perEngine = {};

for (const engine of ["chromium", "firefox", "webkit"]) {
  let browser;
  try {
    browser = await pw[engine].launch();
  } catch (error) {
    console.error(`[expand] ${engine} would not launch: ${String(error).slice(0, 80)}`);
    console.error(`[expand] run \`npx playwright install ${engine}\` in apps/playground-core.`);
    process.exit(1);
  }
  const tab = await browser.newPage();
  // Two elements, and custom properties holding SEVERAL values on purpose: `padding: var(--x)` with
  // `--x: 1px 2px` is two values to the shorthand and nonsense to a longhand, which is the hazard.
  await tab.setContent(
    "<!doctype html><html><body><style>#x,#y{--x:1px 2px;--c:red blue;--s:solid dashed;--o:auto hidden}</style>" +
      "<div id=x></div><div id=y></div></body></html>",
  );

  perEngine[engine] = await tab.evaluate(
    ([names, DOMAINS, PATTERNS, TYPES, expandSource, computedSource]) => {
      const expand = new Function(`return ${expandSource}`)();
      const compare = new Function(`return ${computedSource}`)();

      /** Top-level separators only: `rgb(1, 1, 1)` is ONE value. */
      const tokens = (value, separator = /\s/) => {
        const out = [];
        let depth = 0;
        let at = "";
        for (const ch of value) {
          if (ch === "(") depth++;
          else if (ch === ")") depth--;
          if (depth === 0 && separator.test(ch)) {
            if (at !== "") out.push(at);
            at = "";
            continue;
          }
          at += ch;
        }
        if (at !== "") out.push(at);
        return out;
      };

      /**
       * Two rules that are about CSS rather than about a family, both found by the corpus.
       *
       * - a CSS-WIDE KEYWORD alone is not a component value: it goes on EVERY longhand. Measured,
       *   `background-position: inherit` inherits both axes where a positional rule gave
       *   `x: inherit, y: center`.
       * - one of them beside another value is invalid CSS, so there is nothing to split.
       *
       * And the one that decides the design: **a `var()` cannot be split.** Its content is unknown
       * until computed-value time and may carry several values — `border-color: var(--c)` with
       * `--c: red blue` renders red/blue/red/blue, while `var(--c)` on each longhand is four
       * invalid declarations and a black border. Refusing is the correct answer, not a gap.
       */
      const WIDE = ["inherit", "initial", "unset", "revert", "revert-layer"];
      const beforeSplitting = (value, longhands) => {
        const bare = value.trim();
        if (WIDE.includes(bare)) return { done: Object.fromEntries(longhands.map((one) => [one, bare])) };
        if (tokens(value).some((one) => WIDE.includes(one))) return { refuse: true };
        if (/\bvar\(/.test(value)) return { refuse: true };
        return {};
      };

      // ── Shape 1: POSITIONAL, learned per arity ────────────────────────────────────────────────
      const learnPositional = (name) => {
        /**
         * The value patterns are how a domain is chosen, not just how it is taught.
         *
         * Asking only whether a family takes two values SIDE BY SIDE reads `grid-column` as having
         * no positional shape at all: it accepts `1 / 3` and refuses `1 3`, so the one probe that
         * decided the domain was the one probe it was always going to fail.
         */
        const fill = (sentinels, pattern) => {
          const values = sentinels.slice(0, pattern.slots);
          let at = 0;
          return pattern.sides.map((n) => values.slice(at, (at += n)).join(" ")).join(" / ");
        };
        const domain = DOMAINS.find((one) =>
          PATTERNS.some((pattern) => {
            const got = expand(name, fill(one.sentinels, pattern));
            const keys = Object.keys(got);
            return keys.length > 0 && keys.every((k) => one.sentinels.includes(got[k]));
          }),
        );
        if (domain === undefined) return null;

        const learned = {};
        for (const pattern of PATTERNS) {
          const values = domain.sentinels.slice(0, pattern.slots);
          const got = expand(name, fill(domain.sentinels, pattern));
          if (Object.keys(got).length === 0) continue;
          learned[pattern.key] = Object.fromEntries(
            Object.entries(got).map(([longhand, held]) => {
              const parts = tokens(held);
              const slots = parts.map((one) => values.indexOf(one));
              return [longhand, slots.every((one) => one >= 0) ? { slots } : { literal: held }];
            }),
          );
        }
        if (Object.keys(learned).length === 0) return null;
        const longhands = Object.keys(learned[Object.keys(learned)[0]]);

        return {
          shape: "positional",
          domain,
          longhands,
          split(value) {
            const early = beforeSplitting(value, longhands);
            if (early.refuse) return null;
            if (early.done) return early.done;
            const sides = tokens(value, /\//).map((one) => tokens(one));
            const mapping = learned[sides.map((one) => one.length).join("/")];
            if (mapping === undefined) return null;
            const flat = sides.flat();
            return Object.fromEntries(
              Object.entries(mapping).map(([longhand, how]) => [
                longhand,
                how.literal !== undefined ? how.literal : how.slots.map((i) => flat[i]).join(" "),
              ]),
            );
          },
        };
      };

      // ── Shape 2 and 3: BY TYPE, and by type then order ────────────────────────────────────────
      //
      // The classifier is the ENGINE, not a table: a token fed to the family ALONE lands on exactly
      // the longhands its type owns. So splitting is per-token solo expansion, merged — and no
      // component grammar has to be written here at all. The real compiler would classify from its
      // own keyword tables; this measures whether the DECOMPOSITION is sound, which is the question.
      /**
       * What a longhand HOLDS when set to this token, read back from the engine.
       *
       * Needed because a token and the value a longhand reports are not the same string —
       * `url(a.png)` comes back as `url("a.png")`. Classifying a token by comparing it against the
       * raw text called every normalisation a mismatch, and the first run of the typed shapes put
       * `border: 3px rgb(1, 2, 3)`'s colour into the width slot because of it.
       */
      /**
       * A longhand's own initial VALUE, read off an untouched element.
       *
       * Not the keyword: `animation-duration: initial, initial` is invalid CSS, so a comma list
       * built out of keywords collapses to one value. Measured on `animation: dashed, dashed`,
       * where ours rendered `0s` against the engine's `0s, 0s`.
       */
      const initialOf = (longhand) => {
        const el = document.getElementById("y");
        el.style.cssText = "";
        return getComputedStyle(el).getPropertyValue(longhand);
      };

      /** What a longhand COMPUTES to when set to this value — for telling a real constant from a reset. */
      const computes = (longhand, value) => {
        const el = document.getElementById("y");
        el.style.cssText = "";
        el.style.setProperty(longhand, value);
        return getComputedStyle(el).getPropertyValue(longhand);
      };

      const held = (longhand, token) => {
        const el = document.getElementById("x");
        el.style.cssText = "";
        el.style.setProperty(longhand, token);
        return el.style.getPropertyValue(longhand);
      };

      /**
       * Shapes 2 and 3, by SIGNATURE — and the vocabulary of types is gone.
       *
       * The earlier draft named the types (`length`, `colour`, `line-style`, …) and probed each
       * with a pair of tokens. That vocabulary is wrong per family and cannot be made right:
       * `dashed` is a line style to `border` and a NAME to `animation`, so a constant learned
       * through one of them is a constant for neither. Measured — adding per-arity constants fixed
       * `mask` and took `animation` and `transition` out; restricting them to families whose named
       * types happened not to overlap put those back and dropped `mask` again. The two excluded
       * each other, which is what a wrong abstraction looks like from the inside.
       *
       * So nothing is named. **Two tokens are the same type when they address the same SET of
       * longhands**, and that set is its own name. Signatures partition by construction, so the
       * overlap that forced the choice cannot arise, and the classifier at split time is the same
       * function as the one that learned — there is no table in between to be wrong.
       */
      const learnBySignature = (name) => {
        const PROBE = Object.values(TYPES).flat();

        /** Where a token lands when the family is given it ALONE: the longhands that HOLD it. */
        const signatureOf = (token) => {
          const got = expand(name, token);
          const keys = Object.keys(got).filter((one) => got[one] === held(one, token));
          return keys.length === 0 ? null : keys.join("|");
        };

        const groups = new Map();
        for (const token of PROBE) {
          const signature = signatureOf(token);
          if (signature === null) continue;
          const group = groups.get(signature) ?? { slots: signature.split("|"), tokens: [] };
          group.tokens.push(token);
          groups.set(signature, group);
        }
        if (groups.size < 2) return null;

        const first = groups.values().next().value;
        const longhands = Object.keys(expand(name, first.tokens[0]));
        if (longhands.length === 0) return null;
        const base = Object.fromEntries(longhands.map((one) => [one, "initial"]));

        /**
         * A group with SEVERAL slots, learned from two of its own tokens.
         *
         * Two things come out of the same probe and neither can come from one token: which slot the
         * Nth token takes — `animation: 1.5s` sets the duration and leaves the delay at zero, so
         * one token never reveals the delay is a slot — and what the slots nobody filled are GIVEN,
         * which is a constant rather than the initial value: `background: 3px` leaves
         * `background-position-y` at `center`.
         */
        /**
         * A slot that is another group's SIGNATURE is not this group's to take.
         *
         * The pair probe is two tokens of one group written side by side, and the family may read
         * the second as something else entirely: `animation: ease-in ease-out` is valid CSS, and
         * the engine makes the second one a NAME. The easing group then claimed `animation-name` as
         * a second slot with a constant of `none`, and the first easing token in any value wiped
         * the name that had already been placed — `animation: dashed ease-in` came out nameless.
         */
        const owned = new Set([...groups.keys()].flatMap((one) => one.split("|")));
        /**
         * A group's shape PER ARITY, learned the way the positional one is.
         *
         * Two things need it and neither can come from a single probe. `flex: 7 7` puts the basis
         * at `0%` while `flex: 7` puts it at `0%` too but `flex: 3px` leaves the grow at 1 — so the
         * constants depend on how MANY tokens of the group were written, not just on which group.
         * And `offset: 3px 3px` gives one longhand BOTH tokens (`offset-position: 3px 3px`), which
         * is the same `{slots:[i,j]}` the positional learner already writes down.
         *
         * A constant is only taken for a longhand no OTHER group owns. `border: 1px solid red` has
         * three groups in one value, and a literal learned from a probe of one of them is that
         * probe's leftovers for the other two.
         */
        for (const [signature, group] of groups) {
          const mine = new Set(signature.split("|"));
          const [a, b] = group.tokens;
          group.arity = {};
          for (let n = 1; n <= (b === undefined ? 1 : 2); n++) {
            const values = n === 1 ? [a] : [a, b];
            const got = expand(name, values.join(" "));
            if (Object.keys(got).length === 0) continue;
            group.arity[n] = Object.fromEntries(
              Object.entries(got)
                .map(([longhand, value]) => {
                  /**
                   * A token matches a sentinel either as WRITTEN or as the engine reports it, and
                   * both halves were found the hard way.
                   *
                   * Only through `held` and a longhand holding SEVERAL tokens never matches —
                   * `offset-position: 3px` comes back `3px center`, so `offset: 3px 3px` split into
                   * `3px 9px`, the probe's own sentinels. Only raw, and a normalised one never
                   * matches: `url(a.png)` comes back `url("a.png")`, so `mask: 3px url(b.png)`
                   * emitted `url("a.png")` — a different file.
                   */
                  const slots = tokens(value).map((one) =>
                    values.findIndex((v) => one === v || one === held(longhand, v)),
                  );
                  if (slots.length > 0 && slots.every((one) => one >= 0)) return [longhand, { slots }];
                  if (owned.has(longhand) && !mine.has(longhand)) return null;
                  // A literal that COMPUTES to the untouched value is this probe's reset, not this
                  // group's constant. Keeping them let the last group processed clobber the rest:
                  // `mask: 3px url(a.png)` lost the `center` the length had just put on the y axis.
                  if (computes(longhand, value) === initialOf(longhand)) return null;
                  return [longhand, { literal: value }];
                })
                .filter((one) => one !== null),
            );
          }
          if (b === undefined) continue;
          const two = expand(name, `${a} ${b}`);
          if (Object.keys(two).length === 0) continue;
          const holders = Object.keys(two).filter(
            (one) => (two[one] === held(one, a) || two[one] === held(one, b)) && (mine.has(one) || !owned.has(one)),
          );
          if (holders.length < 2) continue;
          const one = expand(name, a);
          if (Object.keys(one).length === 0) continue;
          group.slots = holders;
          group.order = holders.map((slot) => (two[slot] === held(slot, a) ? 0 : 1));
          group.fill = Object.fromEntries(
            holders.map((slot) => [slot, one[slot] === held(slot, a) ? { slot: 0 } : { literal: one[slot] }]),
          );
        }

        /**
         * A SLASH inside one layer, which `background` and `mask` have: what is in front is the
         * position, what is behind is the size — and the size side is ONE longhand holding several
         * tokens joined, not several slots. Learned from four lengths across a slash.
         */
        let slashed = null;
        for (const [a, b] of Object.values(TYPES)) {
          const probe = expand(name, `${a} ${b} / ${a} ${b}`);
          if (Object.keys(probe).length === 0) continue;
          const ahead = Object.keys(probe).filter((one) => probe[one] === held(one, a) || probe[one] === held(one, b));
          const behind = Object.keys(probe).filter((one) => tokens(probe[one]).length === 2 && !ahead.includes(one));
          if (ahead.length >= 1 && behind.length === 1) {
            slashed = { behind: behind[0] };
            break;
          }
        }

        const several = [...groups.values()].some((one) => one.order !== undefined);
        return {
          shape:
            slashed !== null ? "by signature, with a slash" : several ? "by signature, then order" : "by signature",
          longhands,
          split(value) {
            const early = beforeSplitting(value, longhands);
            if (early.refuse) return null;
            if (early.done) return early.done;

            /**
             * ONE token, and the family's own answer for it.
             *
             * `flex: 3px` is `1 1 3px` — the slots nobody wrote take constants that depend on WHERE
             * the written token landed: a length fills the basis and leaves grow at 1, a number
             * fills the grow and leaves the basis at `0%`. That is a fact per family and per group,
             * not a rule, so it is read rather than derived. The compiler would hold it as a small
             * learned table beside the breadth one; the probe asks the engine, which is the same
             * answer by a shorter road.
             */
            if (tokens(value).length === 1 && tokens(value, /\//).length === 1) {
              const solo = expand(name, value);
              if (Object.keys(solo).length > 0) return solo;
            }

            const out = { ...base };
            const seen = {};
            const filled = new Set();
            /**
             * CSS's own rule when a token fits more than one slot: it takes the FIRST one still
             * free, in the order the family declares its longhands. `animation: ease-in ease-in` is
             * an easing and then a NAME — the same word twice, meaning two different things — and
             * no per-group mapping can say that, because the token's type depends on what is left.
             */
            const elsewhere = (token) => {
              for (const slot of longhands) {
                if (filled.has(slot)) continue;
                if (held(slot, token) === "") continue;
                return slot;
              }
              return null;
            };
            let rest = value;
            if (slashed !== null && tokens(value, /\//).length === 2) {
              const [front, size] = tokens(value, /\//);
              out[slashed.behind] = size;
              rest = front;
            }

            /**
             * Group the tokens first, then use each group's mapping FOR THAT COUNT.
             *
             * Walking token by token cannot see how many of a group there are, and the answer
             * depends on it: `flex: 7` and `flex: 7 7` put the basis at `0%` while `flex: 3px`
             * leaves the grow at `1`. Grouping first also gives a longhand that consumes SEVERAL
             * tokens — `offset: 3px 3px` is one position, not a position and a distance — and it
             * settles `animation: ease-in ease-in` without a rule of its own, because the arity-two
             * probe already saw the engine make the second one a name.
             */
            const order = [];
            const byGroup = new Map();
            for (const one of tokens(rest)) {
              const signature = signatureOf(one);
              if (signature === null || !groups.has(signature)) return null;
              if (!byGroup.has(signature)) {
                byGroup.set(signature, []);
                order.push(signature);
              }
              byGroup.get(signature).push(one);
            }

            for (const signature of order) {
              const group = groups.get(signature);
              const written = byGroup.get(signature);
              const mapping = group.arity?.[written.length];
              if (mapping !== undefined) {
                for (const [longhand, how] of Object.entries(mapping)) {
                  out[longhand] = how.literal !== undefined ? how.literal : how.slots.map((i) => written[i]).join(" ");
                }
                continue;
              }
              // More tokens of one group than any probe taught: fall back to placing them one at a
              // time, and to CSS's own rule where a slot is already taken.
              for (const one of written) {
                if (group.order === undefined) {
                  const other = elsewhere(one);
                  if (other === null) return null;
                  out[other] = one;
                  filled.add(other);
                  continue;
                }
                const at = (seen[signature] ??= 0);
                seen[signature] = at + 1;
                const which = group.slots.filter((_, i) => group.order[i] === at);
                if (which.length === 0) {
                  const other = elsewhere(one);
                  if (other === null) return null;
                  out[other] = one;
                  filled.add(other);
                  continue;
                }
                for (const slot of which) {
                  out[slot] = one;
                  filled.add(slot);
                }
              }
            }
            return out;
          },
        };
      };

      /**
       * ── Shape 4: a COMMA LIST of layers ───────────────────────────────────────────────────────
       *
       * `animation: spin 1s, fade 2s` and a multi-layer `background` are one shape applied N times
       * and zipped back: split on top-level commas, run the per-layer splitter on each, then join
       * each longhand's answers with a comma.
       *
       * One longhand in the family is NOT per-layer, and it has to be learned rather than assumed:
       * `background-color` comes from the LAST layer only. So a longhand whose value carries as
       * many top-level parts as there are layers is per-layer, and one that carries a single part
       * is not — and the engine says which by being handed two layers it can tell apart.
       */
      const learnList = (name, inner) => {
        if (inner === null) return null;
        const pair = Object.entries(TYPES).find(([, [a, b]]) => {
          const got = expand(name, `${a}, ${b}`);
          return Object.keys(got).length > 0 && Object.values(got).some((one) => tokens(one, /,/).length === 2);
        });
        if (pair === undefined) return null;
        const [, [a, b]] = pair;
        /**
         * Which longhands are PER LAYER, learned from a probe whose two layers differ in every slot
         * the family has — not from the first pair that happened to parse.
         *
         * Reading a single-part specified value as "not per layer" was wrong: an untouched longhand
         * reports one `initial` however many layers there are, while the engine still renders it
         * once per layer. Measured on `animation: dashed, dashed`, where ours emitted `0s` against
         * the engine's `0s, 0s`. So the question is the opposite one — which longhand is SHARED —
         * and only a longhand that holds one part while another holds two is.
         */
        /**
         * Which longhand is SHARED rather than per layer — `background-color` comes from the LAST
         * layer only, and everything else repeats.
         *
         * Every type pair that parses is probed, not just the first one that does, and that is the
         * fix rather than a refinement: a shared longhand is invisible in a probe that does not
         * touch it. `background: 3px, 9px` leaves the colour at `initial`, which reads exactly like
         * an untouched per-layer longhand — so `3px, rgb(1, 2, 3)` came out with the colour JOINED,
         * `rgba(0, 0, 0, 0), rgb(1, 2, 3)`, which is not a colour at all.
         *
         * A longhand is shared when some probe gives it ONE part while another longhand in that
         * same probe got two, AND it actually holds a value there rather than `initial`.
         */
        const two = expand(name, `${a}, ${b}`);
        const shared = new Set();
        // MIXED pairs as well as same-type ones. A colour is only legal in the LAST layer, so
        // `background: rgb(1, 1, 1), rgb(2, 2, 2)` is invalid and no same-type probe ever touches
        // `background-color` — it went undetected as shared, and `3px, rgb(1, 2, 3)` came out with
        // the colour joined into `rgba(0, 0, 0, 0), rgb(1, 2, 3)`, which is not a colour.
        const pairs = [];
        const firsts = Object.values(TYPES).map(([one]) => one);
        for (const x of firsts) for (const y of firsts) pairs.push([x, y]);
        for (const [x, y] of pairs) {
          const probe = expand(name, `${x}, ${y}`);
          if (Object.keys(probe).length === 0) continue;
          const parts = Object.fromEntries(Object.keys(probe).map((one) => [one, tokens(probe[one], /,/).length]));
          if (Math.max(...Object.values(parts)) < 2) continue;
          for (const one of Object.keys(probe)) {
            if (parts[one] === 1 && probe[one] !== "initial") shared.add(one);
          }
        }
        const perLayer = Object.fromEntries(Object.keys(two).map((one) => [one, !shared.has(one)]));

        return {
          shape: "comma list",
          longhands: Object.keys(two),
          split(value) {
            const early = beforeSplitting(value, Object.keys(two));
            if (early.refuse) return null;
            if (early.done) return early.done;
            const layers = tokens(value, /,/);
            if (layers.length === 1) return inner.split(value);
            const each = layers.map((one) => inner.split(one));
            if (each.some((one) => one === null)) return null;
            // `initial, initial` is not valid CSS, so a keyword reset has to become the real value
            // before it can sit in a list. Measured on `animation: dashed, dashed`, which rendered
            // one `0s` against the engine's `0s, 0s`.
            const usable = (longhand, held) => (held === "initial" ? initialOf(longhand) : held);
            return Object.fromEntries(
              Object.keys(two).map((one) => [
                one,
                perLayer[one] ? each.map((got) => usable(one, got[one])).join(", ") : each[each.length - 1][one],
              ]),
            );
          },
        };
      };

      // ── Run ───────────────────────────────────────────────────────────────────────────────────
      const covered = [];
      const uncovered = [];

      for (const name of names) {
        /**
         * A property this engine does not HAVE cannot disagree about it.
         *
         * `corner-shape` is Chromium-only today, so "covered in all three" refuses to split a
         * family two engines have never heard of — a bar nothing can clear rather than a fault
         * found. Absence is recorded separately and the real question asked of the rest: is it
         * covered in every engine that HAS it?
         */
        if (!(name in document.getElementById("x").style)) {
          uncovered.push({ name, why: "absent", absent: true });
          continue;
        }
        const byType = learnBySignature(name);
        const learned = learnPositional(name) ?? learnList(name, byType) ?? byType;
        if (learned === null) {
          uncovered.push({ name, why: "no shape learned" });
          continue;
        }

        // The corpus: for a positional family, its own domain; for a typed one, every type's tokens
        // in every order, which is what a shape that depends on ORDER has to be tried against.
        const cases = [];
        if (learned.shape === "positional") {
          const { corpus } = learned.domain;
          for (const pattern of PATTERNS) {
            for (const one of corpus) {
              for (const other of corpus) {
                const values = Array.from({ length: pattern.slots }, (_, i) => (i % 2 === 0 ? one : other));
                let at = 0;
                cases.push(pattern.sides.map((n) => values.slice(at, (at += n)).join(" ")).join(" / "));
              }
            }
          }
        } else {
          const all = Object.values(TYPES).flat();
          for (const one of all) {
            cases.push(one);
            for (const other of all) {
              cases.push(`${one} ${other}`);
              cases.push(`${other} ${one}`);
            }
          }
          for (const wide of WIDE) cases.push(wide);
          cases.push("var(--x)");
          if (learned.shape === "comma list") {
            const some = Object.values(TYPES).flat().slice(0, 8);
            for (const one of some) {
              for (const other of some) {
                cases.push(`${one}, ${other}`);
                cases.push(`${one} ${other}, ${other}`);
                cases.push(`${one}, ${other}, ${one}`);
              }
            }
          }
        }

        const wrong = [];
        let tried = 0;
        for (const text of cases) {
          const theirs = expand(name, text);
          if (Object.keys(theirs).length === 0) continue;
          const mine = learned.split(text);
          if (mine === null) continue;
          tried++;
          const longhands = Object.keys(theirs);
          const [rendered, ours] = compare(name, text, mine, longhands);
          if (rendered === ours) continue;
          if (wrong.length < 3) wrong.push({ text, mine, rendered, ours });
          else wrong.push({ text });
        }
        if (tried === 0) uncovered.push({ name, why: "nothing to try" });
        else if (wrong.length === 0) covered.push({ name, shape: learned.shape, tried });
        else uncovered.push({ name, why: `${wrong.length} of ${tried} wrong`, shape: learned.shape, first: wrong[0] });
      }
      return { covered, uncovered };
    },
    [names, DOMAINS, PATTERNS, TYPES, expandIn.toString(), computedIn.toString()],
  );

  await browser.close();
}

const engines = Object.keys(perEngine);
const has = (engine, name) => !perEngine[engine].uncovered.some((one) => one.name === name && one.absent);
const anyCovered = new Map();
for (const engine of engines) for (const one of perEngine[engine].covered) anyCovered.set(one.name, one);
/** Covered in every engine that HAS the property — an engine without it cannot disagree. */
const everywhere = [...anyCovered.values()].filter((one) =>
  engines.every((e) => !has(e, one.name) || perEngine[e].covered.some((c) => c.name === one.name)),
);
const strict = [...anyCovered.values()].filter((one) =>
  engines.every((e) => perEngine[e].covered.some((c) => c.name === one.name)),
);
const partial = names.filter((name) => engines.some((e) => !has(e, name)) && engines.some((e) => has(e, name)));
const tried = perEngine[engines[0]].covered.reduce((sum, one) => sum + one.tried, 0);
const byShape = {};
for (const one of everywhere) (byShape[one.shape] ??= []).push(one.name);

console.log(`\n  ${names.length} shorthands, ${engines.length} engines\n`);
for (const engine of engines) {
  const { covered, uncovered } = perEngine[engine];
  console.log(`   ${engine.padEnd(9)} split: ${String(covered.length).padStart(3)}   not yet: ${uncovered.length}`);
}
console.log(
  `\n   covered in every engine that HAS it: ${everywhere.length} families, ${tried} values checked in the first engine`,
);
console.log(`   of those, present and covered in all three: ${strict.length}`);
console.log(`   properties not every engine has: ${partial.length} — ${partial.slice(0, 6).join(", ")}\n`);
for (const [shape, list] of Object.entries(byShape)) {
  console.log(`   ${shape} (${list.length})`);
  console.log(`     ${list.join(", ")}\n`);
}

const disagreed = perEngine[engines[0]].uncovered.filter((one) => one.first);
if (disagreed.length > 0) {
  console.log(`   families where a learned shape was WRONG (not merely absent):\n`);
  for (const one of disagreed.slice(0, 6)) {
    console.log(`     ${one.name}  [${one.shape}]  ${one.why}`);
    console.log(`       on \`${one.first.text}\``);
    console.log(`       engine renders: ${one.first.rendered}`);
    console.log(`       ours render:    ${one.first.ours}`);
    console.log(`       we split into:  ${JSON.stringify(one.first.mine)}`);
  }
  console.log("");
}
const nothing = perEngine[engines[0]].uncovered.filter((one) => !one.first);
console.log(`   no shape learned at all (${nothing.length}): ${nothing.map((one) => one.name).join(", ")}\n`);
