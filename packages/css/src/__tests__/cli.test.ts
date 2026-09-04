import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

/**
 * The bin, run as a build would run it.
 *
 * `check.test.ts` covers every decision the command makes. This covers the two things only a real
 * process can show, and they are the two a build depends on: **the exit code**, and what a person
 * reads when it fails. A check that reports correctly and exits 0 is a check that does not exist.
 */

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = join(PACKAGE, "bin.mjs");

const projects: string[] = [];
afterEach(() => {
  for (const each of projects.splice(0)) rmSync(each, { recursive: true, force: true });
});

function project(card: string): string {
  const root = mkdtempSync(join(tmpdir(), "ramonda-css-cli-"));
  projects.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src", "jsx.d.ts"),
    `declare namespace JSX {\n  interface IntrinsicElements { div: { css?: unknown; children?: unknown } }\n  interface Element { readonly _brand: unique symbol }\n}\n`,
  );
  writeFileSync(join(root, "src", "Card.tsx"), card);
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "preserve",
        types: [],
        skipLibCheck: true,
        baseUrl: ".",
        paths: { "@ramonda/css/properties": [join(PACKAGE, "src", "properties.ts")] },
      },
      include: ["src"],
    }),
  );
  return root;
}

/** What a build sees: the output, and the code it exited with. */
function run(root: string): { output: string; status: number } {
  try {
    const output = execFileSync(process.execPath, [BIN, "tsconfig.json"], { cwd: root, encoding: "utf8" });
    return { output, status: 0 };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; status?: number };
    return { output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`, status: failed.status ?? -1 };
  }
}

describe("the bin", () => {
  test("is there before it is built, or a fresh checkout cannot link it", () => {
    // pnpm creates a package's bin links from what is on disk at install time. A bin that IS a build
    // output is not there yet, so the link is skipped and every build calling it fails.
    expect(existsSync(BIN)).toBe(true);
    expect(existsSync(join(PACKAGE, "dist", "cli.js"))).toBe(true);
  });

  test("says what it checked, and exits 0", () => {
    const { output, status } = run(project(`const a = <div css=@( display: flex; )>x</div>;\nexport default a;\n`));

    expect(status).toBe(0);
    expect(output).toContain("[ramonda-css]");
    expect(output).toContain("1 of them carrying a style block");
  });

  test("names the fault at the author's own line, and exits 1", () => {
    const { output, status } = run(
      project(`const a = (\n  <div css=@(\n    dsiplay: flex;\n  )>x</div>\n);\nexport default a;\n`),
    );

    expect(status).toBe(1);
    expect(output).toContain("src/Card.tsx:3:5");
    expect(output).toContain("Did you mean to write 'display'?");
  });

  test("a block it cannot read is reported alone, and exits 1", () => {
    const { output, status } = run(
      project(`const a = (\n  <div css=@(\n    {{name}}: 24px;\n  )>x</div>\n);\nexport default a;\n`),
    );

    expect(status).toBe(1);
    expect(output).toContain("could not be read, so nothing was checked");
    expect(output).toContain("src/Card.tsx:3:5");
    // The position is printed once, not twice — the message carries its own and it is trimmed off.
    expect(output).not.toContain("Card.tsx:3:5  a hole");
  });
});
