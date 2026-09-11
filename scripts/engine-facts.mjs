/**
 * What the three browser-asking generators share.
 *
 * `build-prefixed-properties`, `build-shorthand-leaves` and `build-engine-keywords` all measure a
 * fact out of Chromium, Firefox and WebKit and write it down. One copy of the write and the merge,
 * because three would be the shape this repository keeps finding — and the fourth generator would
 * make the bargain differently.
 *
 * ## Why these files ACCUMULATE rather than being replaced
 *
 * **A browser answers for the platform it is running on.** Measured, after the first CI run went
 * red: `prefixed.generated.ts` holds `-apple-pay-button-style` and `-moz-osx-font-smoothing`, which
 * are macOS builds' names. A Linux runner reports neither, so a file written there and a file
 * written on a Mac can never be byte-equal — and `--check` failed for a difference that was nobody's
 * mistake.
 *
 * The files are already a UNION across three engines, for the reason each generator states: if ANY
 * engine has the property, refusing it would be refusing valid CSS. Platforms are the same argument
 * one step out. So a run keeps what is there and adds what it can see, and `--check` then asks the
 * only question that matters: **is anything MISSING that this machine can see?**
 *
 * What that costs: an entry that gets in wrongly stays until somebody deletes the file and
 * regenerates from scratch. That is the trade, and it is the safe direction — every one of these
 * lists is read to make the checker MORE permissive, never less.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** What a previous run committed, pulled back out of the generated text it wrote. */
export function previousFrom(file, pattern, fallback) {
  if (!existsSync(file)) return fallback;
  const found = pattern.exec(readFileSync(file, "utf8"));
  if (found === null) return fallback;
  // A trailing comma is JSON's one disagreement with the formatter that writes these.
  return JSON.parse(found[1].replace(/,(\s*[}\]])/g, "$1"));
}

/** Every name in either, sorted — the union of what was committed and what this machine sees. */
export function unionOf(previous, measured) {
  return [...new Set([...previous, ...measured])].sort();
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
    console.error(`[${command}] ${file.split("/").slice(-1)[0]} is missing something the engines here report.`);
    console.error(`[${command}] run \`node scripts/${command}.mjs\` and commit the result.`);
    process.exit(1);
  }
  writeFileSync(file, contents);
  return true;
}
