/**
 * Copied content this repository distributes, and the distinctive bytes that prove a build carries
 * it.
 *
 * ## Why it is its own module
 *
 * Two artefacts ship now — the npm tarballs and the extension's `.vsix` — and each is checked where
 * its real bytes are: `check-third-party.mjs` over what `files` publishes, and
 * `package-extension.mjs` over the archive it has just written. The fingerprints have to be the
 * same in both, and a list written out twice is two lists that must agree, which is the fault this
 * repository keeps finding.
 *
 * It was briefly imported from `check-third-party.mjs` instead, and that was wrong for a reason
 * worth keeping: importing a script runs its body, so packaging the extension ran the npm check and
 * would have failed with *its* error, about a package the packager was not asked to look at.
 *
 * ## What a fingerprint is for
 *
 * A package does not have to KNOW it carries somebody else's work: it can arrive through a
 * dependency that is not published, through a bundler, through a refactor that moves a file. So the
 * question asked is *are these bytes in the thing we are about to hand out*, and not *did anyone
 * mean to put them there*.
 */

export const VENDORED = [
  {
    work: "Phosphor Icons",
    /** The opening of the `cursor-click` path — see `packages/theme/src/index.ts`. */
    fingerprint: "M88,24V16a8,8,0,0,1,16,0v8a8,8,0,0,1-16,0Z",
    /** What the notice must name, so a file that exists but says nothing does not pass. */
    names: "Phosphor Icons",
  },
];
