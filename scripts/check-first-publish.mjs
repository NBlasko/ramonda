/**
 * Refuses a release that contains a package npm has never seen.
 *
 *     node scripts/check-first-publish.mjs
 *
 * ## The fault this exists for
 *
 * `@ramonda/css@0.1.0` failed to publish, alone, in the middle of an otherwise green release:
 *
 *     No NPM_TOKEN found, but OIDC is available - using npm trusted publishing
 *     …
 *     error an error occurred while publishing @ramonda/css:
 *     E404 Not Found - PUT https://registry.npmjs.org/@ramonda%2fcss
 *
 * **Trusted publishing cannot CREATE a package.** A trusted publisher is configured on a package
 * that already exists, so for a name npm has never seen there is nothing to configure and nothing
 * that grants the workflow permission to write it — and npm answers a PUT it will not authorise with
 * 404 rather than 403, so the message says "not found" about a package you are trying to create.
 *
 * **It was already written down, in the right file, and it still cost half a release.**
 * `release.yml` says it plainly, beside the line that turns the token off:
 *
 *     A NEW package cannot be published this way: its trusted publisher is configured on a package
 *     page, which does not exist yet. Publish the first version of one with a granular token, then
 *     configure it.
 *
 * So this is not a discovery. It is the same argument `check-manifest-text.mjs` makes about escapes:
 * **care is what failed.** The note is correct, it is in the file a person edits when they change
 * publishing, and it is not in front of anyone at the moment a release runs. A comment cannot stop a
 * release; this can.
 *
 * Why it had never fired before: the repository published with a TOKEN first and moved to OIDC later,
 * and a token may create a package. Every name on npm was created under the old scheme, so the new
 * one had never once been asked for something new — the change was exercised only against the case
 * that already worked, which is this repository's most common shape of fault.
 *
 * ## Why it fails the release rather than warning
 *
 * Because the alternative is what happened: three packages published, one did not, the workflow went
 * red after the irreversible half. Stopping BEFORE `changeset publish` costs a re-run and nothing
 * else — `changeset publish` skips a version already on the registry, so publishing again after the
 * first version is in by hand picks up exactly where this left off.
 *
 * ## What it does NOT claim
 *
 * Only that the NAME exists. Whether the workflow may write to it is npm's own business — a trusted
 * publisher that is configured for the wrong repository still fails, and this cannot see that. It
 * catches the one case that is certain, which is the one that has actually happened.
 *
 * A registry that cannot be reached is UNKNOWN, not missing, and says so without failing: a release
 * must not be blocked by somebody's network, and `verify-versions` beside it takes the same view.
 *
 * ## One more thing about reading the answer
 *
 * **npm's write path is ahead of its read path, and for a NEW package the gap is minutes.** After the
 * hand publish that fixed this, `PUT 200` and `info ok` were in the log while `npm view` still said
 * `E404` — three times, `--prefer-online` included — and a direct `GET` of the registry DOCUMENT was
 * 404 while the TARBALL was already 200. So a fresh 404 is not evidence a publish failed. Read the
 * npm debug log under `~/.npm/_logs`, which records the PUT and its status, or fetch the tarball URL.
 * I reported that publish as failed on a single read, and it had succeeded.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Names changesets is told to leave alone, read from its config rather than repeated here. */
const ignored = new Set(JSON.parse(readFileSync(join(root, ".changeset", "config.json"), "utf8")).ignore ?? []);

/**
 * Every package a release would publish.
 *
 * `private: true` is the real guard against publishing something internal — npm refuses it and
 * changesets skips it — so a private package is not a candidate and is not asked about.
 */
function publishable() {
  const out = [];
  for (const group of ["packages", "apps"]) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, "package.json");
      if (!existsSync(file)) continue;
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      if (manifest.private === true || ignored.has(manifest.name)) continue;
      // The FOLDER is kept, not derived from the name later: `@ramonda/css` lives in
      // `packages/css` and the two agree, but nothing makes them, and the walk covers `apps/` too.
      out.push({ name: manifest.name, where: `${group}/${name}` });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** `exists`, `missing`, or `unknown` — and the three are deliberately not two. */
function onTheRegistry(name) {
  try {
    execFileSync("npm", ["view", name, "name"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return "exists";
  } catch (error) {
    const said = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    // E404 is the registry answering. Anything else — a timeout, a proxy, no network — is this
    // machine failing to ask, which is not evidence about the package.
    return /E404|404 Not Found/.test(said) ? "missing" : "unknown";
  }
}

/**
 * `SELFTEST=missing` plants a package the registry has never heard of and expects to be stopped.
 *
 * It asks npm NOTHING: the registry is the slow part, and what is under test here is the reporting,
 * not the lookup. A check nobody has watched fail is a check nobody has tested — five broken ones
 * sent this repository the wrong way in a single day.
 */
const selftest = process.env.SELFTEST === "missing";

function run() {
  const names = publishable();
  if (names.length < 5) {
    throw new Error(
      `[first-publish] Found only ${names.length} publishable packages, which cannot be right — the ` +
        `walk is broken and this check would pass against nothing.`,
    );
  }

  const missing = [];
  const unknown = [];

  for (const one of names) {
    const answer = selftest ? (one === names[0] ? "missing" : "exists") : onTheRegistry(one.name);
    if (answer === "missing") missing.push(one);
    if (answer === "unknown") unknown.push(one);
  }

  for (const one of unknown) {
    console.log(`[first-publish] ${one.name} — the registry did not answer, so this says nothing about it`);
  }

  if (missing.length > 0) {
    throw new Error(
      `[first-publish] npm has never seen ${missing.length === 1 ? "this package" : "these packages"}:\n\n` +
        missing.map((one) => `        • ${one.name}`).join("\n") +
        `\n\n` +
        `        This release publishes with OIDC trusted publishing, and trusted publishing cannot\n` +
        `        CREATE a package — there is nothing yet to configure a publisher on. npm answers the\n` +
        `        attempt with \`E404 … PUT\`, which reads as "not found" about a package you are creating.\n\n` +
        `        Publish the first version by hand, once, as a user who owns the scope. It asks for\n` +
        `        2FA in a browser — measured: the first PUT is a 401, npm opens a web auth page, and\n` +
        `        the second PUT is the 200. That is the normal flow, and it is why this cannot simply\n` +
        `        be handed a token in CI and forgotten.\n\n` +
        missing.map((one) => `            cd ${one.where} && npm publish --access public`).join("\n") +
        `\n\n` +
        `        Then add the trusted publisher on npmjs.com (GitHub Actions, this repository,\n` +
        `        release.yml) and every version after this one goes through CI like the rest.\n\n` +
        `        Nothing was published. \`changeset publish\` skips a version already on the registry,\n` +
        `        so re-running the release afterwards picks up exactly here.`,
    );
  }

  console.log(`[first-publish] ${names.length} publishable packages, all known to npm`);
}

if (!selftest) {
  run();
} else {
  try {
    run();
  } catch {
    console.log("[first-publish] SELFTEST missing: the planted package was reported, as it must be");
    process.exit(0);
  }
  console.error("[first-publish] SELFTEST missing: the planted package was NOT reported — this check is asleep");
  process.exit(1);
}
