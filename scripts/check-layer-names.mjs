/**
 * A layer name must still mean what an OLDER stylesheet meant by it.
 *
 *     node scripts/check-layer-names.mjs
 *     SELFTEST=collide node scripts/check-layer-names.mjs
 *     SELFTEST=drift   node scripts/check-layer-names.mjs
 *     SELFTEST=crowd   node scripts/check-layer-names.mjs
 *
 * ## What the name is, and what can go wrong with it
 *
 * A shorthand's layer is named by HOW MANY longhands it covers — `background` clears ten, so it is
 * `ramonda.s10`. Names are declared weakest first, so a bigger count is weaker, and a shorthand is
 * weaker than everything it covers. That holds by construction in ONE version: if `S` covers `L`
 * then `S` covers what `L` covers and `L` itself, so `count(S) > count(L)`.
 *
 * It is ACROSS versions that it can break, and that is the whole reason this exists. A page may
 * carry a stylesheet from a package built years ago beside one the application built today, and the
 * two agree about nothing except these names. If a longhand gains sub-properties until its new count
 * reaches its shorthand's OLD count, the old shorthand stops being weaker and the application's
 * narrow rule loses to a package's broad one — silently, in a page nobody edited.
 *
 * ## Why it is a gate and not a rule to remember
 *
 * Shifting every time the table changes is the rule with nothing to remember, and it is also
 * unnecessary: the collision needs a specific event, not merely a change. Measured today, 143
 * covering pairs and the tightest margin is 4 — `grid` at 7 over `grid-template` at 3. Splitting is
 * what widened them: a longhand has no count any more, so it left the comparison entirely, and the
 * old scheme's tightest margin of 2 across 86 pairs is gone with it.
 *
 * So: the counts as of the last release are committed beside this, and the gate says when one of
 * them must move. It does not assume a shift was enough — it checks.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./lib-load-ts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const selftest = process.env.SELFTEST;
const update = process.argv.includes("--update");

const COMPILER = join(HERE, "..", "packages", "css", "src", "compiler");
const { SHORTHANDS } = await loadTs(join(COMPILER, "keywords.generated.ts"));
const { WIDEST } = await loadTs(join(COMPILER, "flatten.ts"));

const FILE = join(HERE, "..", "packages", "css", "layer-counts.json");
const counts = Object.fromEntries(
  Object.keys(SHORTHANDS)
    .filter((one) => !one.startsWith("-"))
    .map((one) => [one, SHORTHANDS[one].length]),
);

if (update) {
  writeFileSync(FILE, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`[layers] wrote ${Object.keys(counts).length} counts — a SHIFT has been taken, deliberately`);
  process.exit(0);
}

const before = JSON.parse(readFileSync(FILE, "utf8"));
const now = { ...counts };

/**
 * Two shorthands that cover EACH OTHER are one property under two names.
 *
 * `gap` and `grid-gap` are the same property, and no ordering can separate them because neither is
 * broader. They produced collisions against an unchanged table until they were taken out.
 */
const covers = (a, b) => a !== b && (SHORTHANDS[a] ?? []).includes(b);
const pairs = [];
for (const a of Object.keys(now)) {
  for (const b of Object.keys(now)) {
    if (!covers(a, b) || covers(b, a)) continue;
    pairs.push([a, b]);
  }
}

/**
 * Each break must be caught by the check it is FOR, not merely by some check.
 *
 * Written first without the kinds, all three selftests passed and all three were caught by the
 * same one — the within-version invariant — because widening a narrow family's count breaks that
 * too. A selftest that passes for the wrong reason says nothing about the check it names.
 */
const EXPECTED = { collide: "covers", drift: "across", crowd: "range", moved: "moved" };

if (selftest === "collide") now[pairs[0][1]] = now[pairs[0][0]];
if (selftest === "drift") {
  /**
   * The cross-version break ALONE: a family grows past what an older release called its shorthand,
   * while staying below what this release calls it. `before` is edited rather than `now`, because
   * editing `now` breaks the within-version invariant at the same time and that check answers first.
   */
  const [wide, narrow] = pairs.find(([a, b]) => before[a] !== undefined && before[b] !== undefined) ?? [];
  if (wide !== undefined) before[wide] = now[narrow];
}
if (selftest === "moved") {
  // A family whose own count grew, which is what CSS adding one longhand to it looks like.
  const [one] = Object.keys(now);
  now[one] = now[one] + 1;
}
if (selftest === "crowd") {
  // Two families neither of which covers the other, both past the end of the range.
  const [one, other] = Object.keys(now).filter((a) => Object.keys(now).every((b) => !covers(a, b) && !covers(b, a)));
  now[one] = WIDEST + 5;
  now[other] = WIDEST + 9;
}

const found = [];

/** The invariant inside ONE version: a shorthand is weaker than everything it covers. */
for (const [wide, narrow] of pairs) {
  if (now[wide] > now[narrow]) continue;
  found.push({
    kind: "covers",
    said: `${wide}(${now[wide]}) does not outrank ${narrow}(${now[narrow]}), which it covers`,
  });
}

/**
 * And ACROSS versions, both directions — which stylesheet is the older one is not ours to decide.
 * A name is compared only where the older release had one for it; a family that did not exist then
 * cannot collide with itself.
 */
for (const [wide, narrow] of pairs) {
  if (before[wide] !== undefined && !(now[narrow] < before[wide]))
    found.push({
      kind: "across",
      said: `${narrow} grew to ${now[narrow]} and no longer outranks an older ${wide}(${before[wide]})`,
    });
  if (before[narrow] !== undefined && !(before[narrow] < now[wide]))
    found.push({
      kind: "across",
      said: `an older ${narrow}(${before[narrow]}) no longer outranks ${wide}(${now[wide]})`,
    });
}

/**
 * A family's OWN count is its name, so a count that moved is a name that moved.
 *
 * Found by being asked the obvious question: `animation` covers 12 and sits in `s12`, and one more
 * animation longhand in CSS makes it `s13`. Measured with two sheets a release apart and their
 * classes joined rather than merged, the OLDER one wins in both load orders — an application's own
 * `animation` loses to a package's because CSS gained a property in between. That is the fault the
 * whole scheme exists to remove, still alive wherever a shorthand is not split.
 *
 * The covering-pair checks below cannot see it: a family is never a pair with itself. This is the
 * moment `DESIGN.md` calls a SHIFT — the name has to move deliberately, and `--update` records it.
 */
for (const [name, count] of Object.entries(now)) {
  if (before[name] === undefined || before[name] === count) continue;
  found.push({
    kind: "moved",
    said: `${name} covered ${before[name]} and covers ${count}, so its layer moved from s${before[name]} to s${count}`,
  });
}

/**
 * Everything past the end of the range shares ONE name, so at most one family may be there.
 *
 * A count above `WIDEST` has no layer of its own and takes `ramonda.a`, the weakest there is. That is
 * safe for `all`, which covers every property and is weaker than everything by definition. A SECOND
 * family up there would share the name with it and the two would be ordered by nothing.
 */
const over = Object.entries(now).filter(([, count]) => count > WIDEST);
if (over.length > 1)
  found.push({ kind: "range", said: `${over.map(([one, count]) => `${one}(${count})`).join(" and ")} share \`a\`` });

console.log(`[layers] ${pairs.length} covering pairs, ${Object.keys(now).length} shorthands, range to ${WIDEST}`);

if (selftest !== undefined) {
  const wanted = EXPECTED[selftest];
  const hit = found.filter((one) => one.kind === wanted);
  if (hit.length === 0) {
    console.error(`[layers] SELFTEST=${selftest} was not caught by the \`${wanted}\` check.`);
    for (const one of found.slice(0, 3)) console.error(`[layers]   caught instead by \`${one.kind}\`: ${one.said}`);
    process.exit(1);
  }
  console.log(`[layers] SELFTEST=${selftest} caught by \`${wanted}\`: ${hit[0].said}`);
  process.exit(0);
}

if (found.length > 0) {
  console.error(`[layers] ${found.length} name(s) no longer mean what an older stylesheet means:`);
  for (const one of found.slice(0, 8)) console.error(`[layers]   ${one.said}`);
  console.error(`[layers] shift the family INSIDE the next-stronger name, then \`--update\` to record it.`);
  process.exit(1);
}
console.log(`[layers] every name still means what an older stylesheet means by it`);
