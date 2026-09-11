import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Refuses a `\uXXXX` escape in a manifest a person reads.
 *
 * ## The fault it exists for
 *
 * `"author": "Nikola Blagojević"`. The escape is legal JSON and means exactly the same thing
 * to every tool — and it is not what anybody wrote. It arrives when a script rewrites a manifest
 * with a serializer that escapes non-ASCII by default, which is the default in Python's `json` and
 * in more than one formatter.
 *
 * Four manifests carried one when this was written: two I had just broken by rewriting them, and
 * two that had been that way long enough that nobody remembered. Three occurrences, two authors,
 * nothing to notice — a description reading `Ramonda — component tree` went to npm.
 *
 * ## Why a gate rather than care
 *
 * Because care is what failed. The rewrite is mechanical and the diff line is easy to skim past;
 * the two older ones prove that it survives review. A grep does not skim.
 *
 * It reads the RAW text rather than the parsed object on purpose: parsed, the escape is already
 * gone and there is nothing left to find.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `\uXXXX`, anywhere in the file. */
const ESCAPE = /\\u[0-9a-fA-F]{4}/;

/** Everything that is not a manifest anybody wrote: installed, built, or generated. */
const SKIP = new Set(["node_modules", "dist", "build", ".git", ".turbo", ".next", "coverage"]);

/**
 * Every manifest a person reads, at ANY depth.
 *
 * **It walked one level for a while, and the manifest that got away was the worst one to miss.**
 * `packages/css/vscode/package.json` is the VS Code extension's, and its `description` is the
 * sentence the marketplace prints under the title. It carried `@@( … )` and an author reading
 * `Nikola Blagojević` — already published, for anyone to read — because the walk stopped one
 * directory above it.
 *
 * So depth is not somewhere to save work: a manifest further down is not a lesser manifest, and
 * here it was the most public one in the repository.
 */
function manifests() {
  const out = [];
  const walk = (dir) => {
    const file = join(dir, "package.json");
    if (existsSync(file)) out.push(file);
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name) || name.startsWith(".")) continue;
      const next = join(dir, name);
      if (statSync(next).isDirectory()) walk(next);
    }
  };
  walk(root);
  return out;
}

const selftest = (which) => process.env.SELFTEST === which;

function run() {
  const found = [];
  const files = manifests();

  if (files.length < 10) {
    throw new Error(
      `[manifest] Found only ${files.length} manifests, which cannot be right — the walk is broken ` +
        `and this check would pass against nothing.`,
    );
  }

  for (const file of files) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (ESCAPE.test(line)) found.push({ where: relative(root, file), line: index + 1, text: line.trim() });
      });
  }

  if (selftest("escape")) {
    found.push({ where: "(selftest)", line: 1, text: '"author": "Nikola Blagojevi\\u0107"' });
  }

  if (found.length > 0) {
    throw new Error(
      `[manifest] These manifests carry a \\uXXXX escape where a character belongs:\n` +
        found.map(({ where, line, text }) => `        ${where}:${line}  ${text}`).join("\n") +
        `\n\n        Legal JSON, and not what anybody wrote. It comes from a serializer that escapes\n` +
        `        non-ASCII by default. Write the character.`,
    );
  }

  console.log(`[manifest] ${files.length} manifests, no \\uXXXX escape where a character belongs`);
}

if (!selftest("escape")) {
  run();
} else {
  try {
    run();
  } catch {
    console.log("[manifest] SELFTEST escape: the planted fault was reported, as it must be");
    process.exit(0);
  }
  console.error("[manifest] SELFTEST escape: the planted fault was NOT reported — this check is asleep");
  process.exit(1);
}
