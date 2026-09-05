/**
 * Does the transform reach the TEST RUNNER? — the second thing the audit listed as unexamined.
 *
 * A component under test is compiled by the test runner, not by the dev server. If the transform
 * does not reach it, every test touching a styled component stops compiling — the kind of thing
 * discovered late and cursed loudly.
 *
 * Reasoning says yes: Vitest transforms through Vite, so a Vite plugin covers it. This runs it.
 *
 * The fixture is written to a temp directory rather than kept in the repository, because a `.tsx`
 * file containing `@@( … )` cannot be read by the formatter or the linter — measured in DESIGN.md,
 * and there is no reason to make that this repository's problem.
 *
 *     node packages/css/prototype-testrunner.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, globSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = process.cwd();
const core = join(repo, "packages/core");
const vitest = globSync("node_modules/.pnpm/vitest@*/node_modules/vitest/vitest.mjs", { cwd: repo })[0];
if (vitest === undefined) throw new Error("vitest not found in the store");

const dir = mkdtempSync(join(tmpdir(), "css-testrunner-"));
symlinkSync(join(core, "node_modules"), join(dir, "node_modules"));

writeFileSync(
  join(dir, "package.json"),
  JSON.stringify({ name: "probe", private: true, type: "module", version: "0.0.0" }),
);

const config = (enforce) => `import { defineConfig } from "vitest/config";

/** Stands in for the real transform: it rewrites \`css=@@( … )\` into ordinary attributes. */
const cssBlocks = () => ({
  name: "css-blocks",
  ${enforce ? 'enforce: "pre" as const,' : "// enforce deliberately omitted"}
  transform(code: string, id: string) {
    if (!id.endsWith(".tsx") || !code.includes("=@@(")) return null;
    return {
      code: code.replace(/css=@\\(([\\s\\S]*?)\\)>/g, (_m, body: string) => {
        const holes = [...body.matchAll(/\\{\\{([\\s\\S]*?)\\}\\}/g)].map((m) => m[1]);
        return \`className="r-abc" data-vars={[\${holes.join(",")}].join("|")}>\`;
      }),
      map: null,
    };
  },
});

export default defineConfig({
  plugins: [cssBlocks()],
  esbuild: { jsx: "automatic", jsxImportSource: "@ramonda/core", target: "es2022" },
  resolve: {
    alias: [
      { find: "@ramonda/core/jsx-dev-runtime", replacement: ${JSON.stringify(join(core, "dist/jsx-dev-runtime.js"))} },
      { find: "@ramonda/core/jsx-runtime", replacement: ${JSON.stringify(join(core, "dist/jsx-runtime.js"))} },
      { find: "@ramonda/core", replacement: ${JSON.stringify(join(core, "dist/index.js"))} },
    ],
  },
  test: { environment: "jsdom", include: ["src/**/*.test.tsx"] },
});
`;

// This file does not parse without the plugin. That is the point of it.
writeFileSync(
  join(dir, "src.test.tsx"),
  `import { describe, test, expect } from "vitest";
import { Component } from "@ramonda/core";

class Card extends Component {
  accent = "#10b981";
  render() {
    return (
      <div css=@@(
        display: flex;
        border-left: {{this.accent}};
      )>
        <span>Nikola</span>
      </div>
    );
  }
}

describe("the transform reaches the test runner", () => {
  test("the block was compiled before the test ran", () => {
    const tree = new Card({} as never).render();
    expect(JSON.stringify(tree)).toContain("r-abc");
    expect(JSON.stringify(tree)).toContain("#10b981");
  });
});
`,
);
execFileSync("mkdir", ["-p", join(dir, "src")]);
execFileSync("mv", [join(dir, "src.test.tsx"), join(dir, "src/probe.test.tsx")]);

function run(enforce) {
  writeFileSync(join(dir, "vitest.config.ts"), config(enforce));
  try {
    const out = execFileSync("node", [join(repo, vitest), "run"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: /Tests {2}1 passed/.test(out), note: "1 passed" };
  } catch (error) {
    const text = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    const line = text.match(/ERROR: [^\n]+/)?.[0] ?? text.match(/Tests {2}[^\n]+/)?.[0] ?? "failed";
    return { ok: false, note: line.trim() };
  }
}

const withPre = run(true);
const without = run(false);
rmSync(dir, { recursive: true, force: true });

console.log(`enforce: "pre"       ${withPre.ok ? "PASSES" : "fails"}   ${withPre.note}`);
console.log(`no enforce           ${without.ok ? "passes" : "FAILS "}   ${without.note}`);
console.log(
  `\n${withPre.ok && !without.ok ? 'The transform reaches the test runner, and `enforce: "pre"` is what puts it before esbuild.' : "Unexpected — read the notes above."}`,
);
