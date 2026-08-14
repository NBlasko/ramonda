import { describe, expect, test } from "vitest";
import { PORTAL_TARGET_ATTR } from "../document";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Everything this package imports at runtime is something an install of it brings along.
 *
 * The fault this guards is the one the package exists to prevent, and it very nearly shipped
 * inside the package itself: `linkedom` was declared a PEER, and the scaffolder put it in a
 * generated project's `devDependencies`. A production install — `npm ci --omit=dev` — then dropped
 * it, and `npm start` died on `ERR_MODULE_NOT_FOUND` before serving one request.
 *
 * A peer is a request that the CONSUMER install something, and it is right when the consumer must
 * choose the copy — a plugin sharing its host's instance. Nothing here is shared: `installDom`
 * hard-imports one DOM, and a caller who wants a different one has `installWindow`. So it is an
 * ordinary dependency, and this asserts that every import stays one.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/** The package a bare specifier resolves to — `@scope/name/sub` → `@scope/name`, `a/b` → `a`. */
function packageOf(specifier: string): string | undefined {
  if (specifier.startsWith(".")) return undefined;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

function imports(): { file: string; from: string }[] {
  const out: { file: string; from: string }[] = [];
  for (const entry of readdirSync(join(root, "src"), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const source = readFileSync(join(root, "src", entry.name), "utf8");
    for (const match of source.matchAll(/^import\s[^"']*from\s*["']([^"']+)["']/gm)) {
      out.push({ file: entry.name, from: match[1] });
    }
  }
  return out;
}

describe("what the package imports, an install of it provides", () => {
  test("every runtime import is a dependency — not a peer, not a devDependency", () => {
    const runtime = new Set(Object.keys(pkg.dependencies ?? {}));
    const found = imports();

    // A guard on the guard: a run that read no imports would assert nothing.
    expect(found.length).toBeGreaterThan(0);

    for (const { file, from } of found) {
      const name = packageOf(from);
      if (name === undefined) continue;
      // `node:` is the runtime itself. It is still worth naming — see the next test.
      if (name.startsWith("node:")) continue;
      expect(runtime, `src/${file} imports "${name}", which an install would not bring`).toContain(name);
    }
  });

  test("nothing reaches for a Node built-in", () => {
    // The package argues for linkedom over jsdom because it needs no Node built-in, which is what
    // lets the same render run on Cloudflare Workers, Deno Deploy or Vercel Edge. Importing one
    // here takes that back — a `node:` specifier is exactly what those runtimes gate behind a
    // compatibility flag, if they allow it at all.
    const builtins = imports().filter(({ from }) => from.startsWith("node:"));
    expect(builtins, `${builtins.map((b) => `src/${b.file} imports ${b.from}`).join(", ")}`).toEqual([]);
  });
});

/**
 * The one string this package and `@ramonda/core` must agree on.
 *
 * A named portal target is a PROTOCOL between three parties: core's server render collects into a
 * container, this package writes the container into the shell, and core's client resolves the name
 * against it. The attribute is how the third step finds the first, and it is written out in two
 * packages because this one does not depend on core at runtime.
 *
 * Two copies of a protocol constant with nothing comparing them is how a rename ships: the server
 * writes one attribute, the client looks for another, finds nothing, and builds the subtree a
 * second time. The page looks right. Nothing throws.
 */
describe("the attribute a portal target is found by", () => {
  test("is the same string core writes and looks for", () => {
    // Read from core's SOURCE rather than imported: importing `@ramonda/core` needs a DOM, and a
    // guard that has to boot a document to check a string constant is a guard people delete. If
    // the file or the declaration moves, this fails loudly, which is the right answer — an
    // unverifiable protocol is what it exists to prevent.
    const source = readFileSync(join(root, "../core/src/base/portalTarget.ts"), "utf8");
    const declared = /export const PORTAL_TARGET_ATTR = "([^"]+)"/.exec(source)?.[1];

    expect(declared, "could not read PORTAL_TARGET_ATTR from @ramonda/core's source").toBeDefined();
    expect(PORTAL_TARGET_ATTR, "this package and @ramonda/core disagree on the portal target attribute").toBe(declared);
  });
});
