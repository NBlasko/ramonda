import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VENDORED } from "./vendored.mjs";

/**
 * Every published package that DISTRIBUTES somebody else's work ships the notice for it.
 *
 * ## Why a gate rather than a note
 *
 * A licence review found this by accident: thirteen SVG paths from Phosphor Icons are written in
 * `@ramonda/theme`, which is private and publishes nothing — and the devtools panel that draws them
 * is bundled, so the paths reach `@ramonda/devtools/dist`, which npm publishes. The attribution was
 * a comment in a source file nobody downloads.
 *
 * That is the shape this has to keep catching. A package does not have to KNOW it carries somebody
 * else's work: it can arrive through a dependency that is not published, through a bundler, through
 * a refactor that moves a file. So the check is on the OUTPUT — the bytes that ship — and not on
 * anybody's intention.
 *
 * ## What it does
 *
 * For each fingerprint below, find which published packages' shipped files contain it, and require
 * a `THIRD-PARTY.md` in each one that does, naming the work. A fingerprint is a distinctive string
 * from the copied content itself, long enough that nothing else produces it by chance.
 *
 * MIT asks that its permission notice travel with "all copies or substantial portions", and the
 * notice cannot travel if it is not in the tarball.
 */

const root = join(import.meta.dirname, "..");
const TAG = "[third-party]";

/** Every package npm would publish, with the paths its `files` entry ships. */
function published() {
  const found = [];
  for (const manifest of globSync("packages/*/package.json", { cwd: root })) {
    const at = join(root, manifest);
    const read = JSON.parse(readFileSync(at, "utf8"));
    if (read.private === true) continue;
    found.push({ name: read.name, dir: join(root, manifest, ".."), files: read.files ?? [] });
  }
  return found;
}

/** Everything one package ships, as text, so a fingerprint can be looked for in it. */
function shipped(pkg) {
  const out = [];
  for (const entry of pkg.files) {
    const at = join(pkg.dir, entry);
    if (!existsSync(at)) continue;
    const inside = globSync("**/*", { cwd: at, nodir: true }).map((one) => join(at, one));
    for (const file of inside.length > 0 ? inside : [at]) {
      try {
        out.push(readFileSync(file, "utf8"));
      } catch {
        // A binary that cannot be read as text cannot hold the fingerprint either.
      }
    }
  }
  return out.join("\n");
}

const problems = [];
let carried = 0;
/** Which works were really seen in a shipped file — see the check at the end. */
const found = new Set();

/**
 * The corpus itself, before anything is asked of it.
 *
 * Measured by breaking it: with the glob pointing at a directory that does not exist, this printed
 * *1 vendored work(s), carried by 0 published package(s), each with its notice* and exited 0 — a
 * sentence that reads like an all-clear for a run that read nothing. A rename, a move to a
 * different folder, a `files` entry that stops resolving: each would leave the licence gate green
 * and looking at nothing.
 */
const packages = published();
if (packages.length === 0) {
  console.error(`\n${TAG} found no published packages to look in — the glob matches nothing.\n`);
  process.exit(1);
}

for (const pkg of packages) {
  const text = shipped(pkg);
  for (const one of VENDORED) {
    if (!text.includes(one.fingerprint)) continue;
    carried++;
    found.add(one.work);
    const notice = join(pkg.dir, "THIRD-PARTY.md");
    if (!existsSync(notice)) {
      problems.push(`${pkg.name} ships ${one.work} and has no THIRD-PARTY.md`);
      continue;
    }
    if (!pkg.files.includes("THIRD-PARTY.md")) {
      problems.push(`${pkg.name} has a THIRD-PARTY.md and does not list it in \`files\`, so npm leaves it out`);
      continue;
    }
    const said = readFileSync(notice, "utf8");
    if (!said.includes(one.names)) problems.push(`${pkg.name}'s THIRD-PARTY.md does not name ${one.work}`);
    else if (!/Permission is hereby granted/.test(said)) {
      problems.push(`${pkg.name}'s THIRD-PARTY.md names ${one.work} and carries no permission notice`);
    }
  }
}

if (!existsSync(join(root, "THIRD-PARTY.md"))) problems.push("the repository has no THIRD-PARTY.md at its root");

/**
 * And a fingerprint nothing carries, which is the other way this goes quiet.
 *
 * The list describes work this repository DOES distribute, so an entry no shipped file contains
 * means one of two things and both need a person: the vendoring was removed and the entry is stale,
 * or the bytes moved and this stopped finding them. Either way the gate is no longer watching what
 * it says it watches.
 */
for (const one of VENDORED) {
  if (!found.has(one.work)) {
    problems.push(
      `${one.work} is in the list and no published file contains it — remove the entry if it is no ` +
        `longer distributed, or find out why the fingerprint stopped matching`,
    );
  }
}

if (problems.length > 0) {
  console.error(`\n${TAG} ${problems.length} problem(s):\n\n${problems.map((one) => `  - ${one}`).join("\n")}\n`);
  process.exit(1);
}

console.log(
  `${TAG} ${VENDORED.length} vendored work(s), carried by ${carried} published package(s), each with its notice`,
);
console.log(`${TAG} the .vsix is scanned where it is written — see scripts/package-extension.mjs`);
