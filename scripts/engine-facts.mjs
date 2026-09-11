/**
 * What the three browser-asking generators share.
 *
 * `build-prefixed-properties`, `build-shorthand-leaves` and `build-engine-keywords` all measure a
 * fact out of Chromium, Firefox and WebKit and write it down. One copy of the write, because three
 * would be the shape this repository keeps finding — and the fourth generator would make the bargain
 * differently.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Write it, or — under `--check` — fail when what is on disk is not what the engines just said.
 *
 * Shared by the three generators that ask a BROWSER, because all three make the same bargain and the
 * fourth would make it differently. The message names the command, since a person who meets this in
 * CI has not run the generator and should not have to find its name.
 */
export function writeOrCheck(file, contents, command, check) {
  const had = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (had === contents) return false;
  if (check) {
    console.error(`[${command}] ${file.split("/").slice(-1)[0]} is not what the engines say.`);
    console.error(`[${command}] run \`node scripts/${command}.mjs\` and commit the result.`);
    process.exit(1);
  }
  writeFileSync(file, contents);
  return true;
}
