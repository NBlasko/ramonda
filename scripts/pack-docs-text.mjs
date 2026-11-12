/**
 * Puts the docs, as text, into `@ramonda/check` — the offline docs `ramonda-check explain` and
 * `ramonda-check docs` read.
 *
 *     node scripts/pack-docs-text.mjs [target]
 *
 * ## Why at release, and why this package
 *
 * The docs a person has installed should be the docs for what they installed, and `ramonda.dev`
 * describes only the latest release. `@ramonda/check` is a development dependency of every project
 * `create-ramonda` makes and already the project's command line, so the text costs nothing in a
 * production install.
 *
 * The text is what the docs build writes to `apps/docs/src/generated/text` — one Markdown file per
 * page, `llms.txt` and `llms-full.txt`, from the same source the site is rendered from. It is
 * COPIED here rather than generated, because generating it needs the docs' own build, which itself
 * imports `@ramonda/check`: the docs are built from the package, and the package carries the docs.
 * `pnpm release` runs `pnpm build` first, which writes the text; this runs after it, before
 * `changeset publish` packs the folder. It is not committed (`.gitignore`).
 *
 * Refuses when the docs have not been built: a package published without them would answer every
 * `explain` with "not installed", which is worse than failing the release here.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "apps", "docs", "src", "generated", "text");
const target = resolve(process.argv[2] ?? join(root, "packages", "check", "docs"));

for (const needed of ["llms.txt", "llms-full.txt", join("reference", "diagnostics", "rmd020.md")]) {
  if (!existsSync(join(source, needed))) {
    console.error(
      `[pack-docs] ${join(source, needed)} is not there. Build the docs first — \`pnpm build\` — so the\n` +
        `            package does not ship without the docs its commands read.`,
    );
    process.exit(1);
  }
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`[pack-docs] the docs as text → ${target}`);
