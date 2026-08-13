#!/usr/bin/env node
/**
 * The launcher, committed, because a bin that IS a build output cannot be linked before it is built.
 *
 * `pnpm install` on a fresh checkout creates a package's bin links from what is on disk at that
 * moment, and `dist/cli.js` is not there yet — it warns and skips, and every build that calls
 * `ramonda-check` then fails with `not found`. A file that is always present takes the link, and
 * the build output is reached through it.
 */
import "./dist/cli.js";
