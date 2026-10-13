/**
 * What a gate prints when its SELFTEST caught the break it planted: ONE line, on stdout.
 *
 * A selftest that catches its break is a pass, and it used to print that break in the words of a
 * real failure — `[split] 12 of 15494 values split into a different page`, on stderr — so a green CI
 * log was full of lines that read as faults. A user asked whether they were assertions or only logs.
 * They are assertions: a selftest that catches NOTHING still prints its failure and exits 1. Only
 * the pass is quiet, so every detailed difference left in a log is a real one.
 *
 * The first thing found is on the line, so a reader can see the check caught the break it planted
 * and not something else.
 */
export function caughtIt(tag, selftest, found, describe = String) {
  const first = found.length === 0 ? "" : ` — the first: ${describe(found[0]).slice(0, 140)}`;
  console.log(`[${tag}] SELFTEST=${selftest} caught its break, as it must: ${found.length} reported${first}`);
  process.exit(0);
}
