/**
 * What the four browser-asking generators share.
 *
 * `build-prefixed-properties`, `build-shorthand-leaves`, `build-engine-keywords` and
 * `build-numberless-properties` each measure a fact out of Chromium, Firefox and WebKit and write it
 * down. One copy of the write and the merge, because four would be the shape this repository keeps
 * finding.
 *
 * ## Why these files ACCUMULATE rather than being replaced
 *
 * **A browser answers for the platform it is running on.** Measured, after the first CI run went
 * red: `prefixed.generated.ts` holds `-apple-pay-button-style` and `-moz-osx-font-smoothing`, which
 * are macOS builds' names. A Linux runner reports neither, so a file written there and a file
 * written on a Mac can never be byte-equal — and `--check` failed for a difference that was nobody's
 * mistake.
 *
 * So a run does not replace what is committed; it merges with it. Which merge depends on what the
 * list is READ FOR, and that is the question to ask of any new one:
 *
 * ## Three shapes, and each takes a different merge
 *
 * **A list that WIDENS a check** — `prefixed`, `keywords.engine`. If any engine has the property or
 * accepts the value, refusing it would refuse valid CSS. Platforms are the same argument one step
 * out, so these take the UNION and `--check` asks: *is anything MISSING that this machine sees?*
 *
 * **A list that NARROWS one** — `numberless`. It says a bare number is a MISTAKE, so believing it too
 * readily refuses valid CSS, which `properties.ts` names as the one failure a type map may not have.
 * It takes the INTERSECTION and shrinks: one engine on one machine accepting a number ends the claim
 * for everybody. `--check` asks the mirrored question: *does this machine ACCEPT anything the file
 * refuses?* See {@link intersectionOf}.
 *
 * **A list that changes the OUTPUT** — `leaves`, which reaches `SHORTHANDS` and decides what a
 * shorthand clears in the CSS this package emits. Neither question above fits it: it is not a check,
 * and both directions disagree with some engine. It takes the union for a reason of its own, stated
 * in its generator — every fault it was written for was a leaf that was MISSING, and a style kept
 * that plain CSS resets.
 *
 * **This note used to say all of them widen a check**, and that sentence is how `numberless` stayed
 * wrong: it was the one generator with no merge at all, recomputing per machine, and the criterion
 * written here did not fit it. A blanket claim is what a review checks a list against, so it has to
 * be true of every list.
 *
 * What the merging costs: an entry that gets in wrongly stays, or one that should return never does,
 * until somebody deletes the file and regenerates from scratch. That is the trade in both
 * directions.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** What a previous run committed, pulled back out of the generated text it wrote. */
export function previousFrom(file, pattern, fallback) {
  if (!existsSync(file)) return fallback;

  const found = pattern.exec(readFileSync(file, "utf8"));
  /**
   * A file that is THERE and cannot be read is a fault, not an empty start.
   *
   * Both used to answer with the fallback, and the two are opposite situations: no file means
   * nothing has been claimed yet, while a file the pattern no longer matches means everything
   * claimed so far is being discarded — silently. What follows is a run written from one machine's
   * view, which is precisely what these merges exist to prevent, and CI would then fail with a
   * message blaming the engines for a broken regex.
   *
   * It can only happen two ways, and both are worth stopping: the generator's own pattern drifted
   * from the text it writes, or somebody edited a file whose header says `Do not edit`.
   */
  if (found === null) {
    throw new Error(
      `${file} exists and does not match the pattern that reads it back — so every name committed ` +
        `so far would be discarded. Either the generator's pattern has drifted from the text it ` +
        `writes, or the file was edited by hand. Delete it to start over deliberately.`,
    );
  }

  // A trailing comma is JSON's one disagreement with the formatter that writes these.
  return JSON.parse(found[1].replace(/,(\s*[}\]])/g, "$1"));
}

/** Every name in either, sorted — the union of what was committed and what this machine sees. */
export function unionOf(previous, measured) {
  return [...new Set([...previous, ...measured])].sort();
}

/**
 * Only the names in BOTH — for the one list here that is read to make the checker STRICTER.
 *
 * The note above says every one of these lists widens what is allowed, and `numberless.generated.ts`
 * is the exception: it says a bare number is a MISTAKE, so believing it too readily refuses valid
 * CSS, which `properties.ts` names as the one failure a type map may not have.
 *
 * So it accumulates the other way round. A union grows across platforms because one engine having a
 * property is enough; this shrinks, because one engine ACCEPTING a number is enough to end the
 * claim. `--check` then asks the question that matters for this shape: **does this machine accept
 * anything the file refuses?**
 *
 * Measured, and it is why this exists: the intersection is 241 properties on macOS and a different
 * number on a Linux runner, with the same engine versions — WebKit there is a different build. A
 * file written on one and checked on the other can never be byte-equal, and CI went red for a
 * difference that was nobody's mistake.
 *
 * What it costs is the mirror of the union's cost: a property that becomes numberless later never
 * gets in until somebody deletes the file and regenerates from scratch. That is the safe direction
 * for a list that REFUSES.
 */
export function intersectionOf(previous, measured) {
  return measured.filter((one) => previous.includes(one)).sort();
}

/** The same, for a map of lists: every key in either, and within a key every value in either. */
export function unionOfMap(previous, measured) {
  const out = {};
  for (const key of [...new Set([...Object.keys(previous), ...Object.keys(measured)])].sort()) {
    out[key] = unionOf(previous[key] ?? [], measured[key] ?? []);
  }
  return out;
}

/**
 * Write it, or — under `--check` — fail when this machine can see something the file does not hold.
 *
 * The caller has already merged, so a difference here means exactly that: the engines on THIS
 * machine said something new. A platform that sees less reproduces the file unchanged and passes.
 *
 * The message names the command, since a person who meets this in CI has not run the generator and
 * should not have to go and find its name.
 */
export function writeOrCheck(file, contents, command, check) {
  const had = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (had === contents) return false;
  if (check) {
    // Direction-neutral on purpose: this compares text and cannot tell an addition from a removal.
    // It said "is missing something", which is true of the lists that only grow and a guess about
    // the one that only shrinks.
    console.error(`[${command}] ${file.split("/").slice(-1)[0]} is not what the engines here report.`);
    console.error(`[${command}] run \`node scripts/${command}.mjs\` and commit the result.`);
    process.exit(1);
  }
  writeFileSync(file, contents);
  return true;
}
