import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { checkProject } from "../check";

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JSX = `declare namespace JSX {\n  interface IntrinsicElements { div: { css?: unknown; children?: unknown } }\n  interface Element { readonly _brand: unique symbol }\n}\n`;

const check = (card: string) => {
  const root = mkdtempSync(join(tmpdir(), "p5-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "jsx.d.ts"), JSX);
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
  return checkProject(join(root, "tsconfig.json")).findings;
};

/**
 * The fault is marked `@@@`, and it is one only TYPESCRIPT catches — which is the whole point.
 *
 * `position` is union-typed, so `statik` is `TS2820` rather than any rule of ours. A rule works on
 * the author's offsets directly and exercises no mapping at all: the first version of this used
 * `dsiplay`, and breaking `homeOf` on purpose left all twelve green. A test that cannot fail for the
 * reason it names is worth nothing, and this repository has been caught by that before.
 */
const SHAPES: [string, string][] = [
  ["first declaration", `const a = <div css={@@(\n  @@@position: statik;\n)}>x</div>;\nexport default a;\n`],
  [
    "second declaration",
    `const a = <div css={@@(\n  color: red;\n  @@@position: statik;\n)}>x</div>;\nexport default a;\n`,
  ],
  [
    "after a hole",
    `declare const t: string;\nconst a = <div css={@@(\n  color: {t};\n  @@@position: statik;\n)}>x</div>;\nexport default a;\n`,
  ],
  [
    "after two holes",
    `declare const w: string;\ndeclare const t: string;\nconst a = <div css={@@(\n  border: {w} solid {t};\n  @@@position: statik;\n)}>x</div>;\nexport default a;\n`,
  ],
  [
    "inside a nested rule",
    `const a = <div css={@@(\n  &:hover {\n    @@@position: statik;\n  }\n)}>x</div>;\nexport default a;\n`,
  ],
  [
    "two levels deep",
    `const a = <div css={@@(\n  &:hover { & .t {\n    @@@position: statik;\n  } }\n)}>x</div>;\nexport default a;\n`,
  ],
  [
    "inside a media query",
    `const a = <div css={@@(\n  @media (min-width: 40rem) {\n    @@@position: statik;\n  }\n)}>x</div>;\nexport default a;\n`,
  ],
  ["after a comment", `const a = <div css={@@(\n  /* why */\n  @@@position: statik;\n)}>x</div>;\nexport default a;\n`],
  [
    "after a string",
    `const a = <div css={@@(\n  content: "a;b";\n  @@@position: statik;\n)}>x</div>;\nexport default a;\n`,
  ],
  [
    "in the second block",
    `const a = @@( color: red; );\nconst b = @@(\n  @@@position: statik;\n);\nexport default [a, b];\n`,
  ],
  [
    "after a custom property",
    `const a = <div css={@@(\n  --row: 2rem;\n  @@@position: statik;\n)}>x</div>;\nexport default a;\n`,
  ],
  [
    "CRLF",
    `const a = <div css={@@(\r\n  color: red;\r\n  @@@position: statik;\r\n)}>x</div>;\r\nexport default a;\r\n`,
  ],
];

/**
 * A report lands exactly on the fault, across every shape that moves an offset.
 *
 * Review pass 5. A mapping is the one thing where being nearly right is indistinguishable from being
 * right until somebody is looking at the wrong line, so it is asserted exhaustively rather than on
 * the case that happened to be written first: a hole before the fault, two holes, two levels of
 * nesting, a media query, a comment, a string holding a `;`, a second block, a custom property,
 * and CRLF — each of which shifts author offsets against virtual ones in its own way.
 *
 * **Seen to fail.** `homeOf` returning `0` moves every one of these to `1:1`. Worth writing down
 * because the first break tried was `offset + 1` and left all twelve green — correctly: inside a
 * REWRITTEN run, a quoted key or a folded value, `homeOf` answers with the run's start, so one
 * character either way is the same author offset. A break has to leave the run to be visible.
 *
 * **The round trip is NOT the property to test here**, which is the thing this pass established.
 * `virtualOf` is deliberately not the inverse of `homeOf`: its own note says a rewritten run — a
 * quoted key, a folded value — has no offset-for-offset correspondence, so a caret is placed
 * proportionally inside the emitted token and clamped to stay there, because being INSIDE the token
 * is what makes completion work. Sweeping every offset through and back reports most of a block as
 * "wrong" and none of it is. What a diagnostic owes is this: the position it names is the position
 * of the fault.
 */
test.each(SHAPES)("%s: the report lands on the fault", (_label, marked) => {
  const card = marked.replace("@@@", "");
  const at = marked.indexOf("@@@");
  const before = card.slice(0, at);
  const line = before.split(/\r?\n/).length;
  const column = at - (before.lastIndexOf("\n") + 1) + 1;

  const [found] = check(card);

  expect(found).toBeDefined();
  expect({ line: found.line, column: found.column }).toEqual({ line, column });
});
