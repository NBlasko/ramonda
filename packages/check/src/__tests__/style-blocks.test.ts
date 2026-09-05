// @vitest-environment node
// Writes a project to a temp directory and builds a real program over it, so it needs `node:fs`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { analyzeProject } from "../analyze";

/**
 * Reading a project whose source contains `@@( … )` style blocks.
 *
 * ## The fault this exists for, and it is silence
 *
 * The block's syntax is not TypeScript. The compiler's parser gives up at it and error-recovers, so
 * every rule that walks the tree below that point simply finds LESS — and the run looks exactly as
 * healthy as a clean one. Measured with this package's own CLI before the overlay existed, on one
 * component differing only in where the block sits among the attributes:
 *
 * ```
 * block LAST  :  half-built-keyboard-path  positive-tabindex  unnamed-image
 * block FIRST :  unnamed-image
 * ```
 *
 * Two accessibility faults gone, exit code 1 either way. **A report that is trusted and quietly
 * incomplete is worse than no report**, which is why this is not something to leave for later.
 *
 * ## Why the project is written to a temp directory
 *
 * A `.tsx` fixture containing `@@( … )` cannot be read by this repository's formatter or its linter —
 * measured, and there is no reason to make that the repository's problem. The other fixtures live on
 * disk because they are ordinary TypeScript.
 */

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

const projects: string[] = [];
afterEach(() => {
  for (const each of projects.splice(0)) rmSync(each, { recursive: true, force: true });
});

/** A project the analyzer can be pointed at, with the same framework stub the fixtures use. */
function project(app: string): string {
  const root = mkdtempSync(join(tmpdir(), "ramonda-check-css-"));
  projects.push(root);
  mkdirSync(join(root, "src"), { recursive: true });

  writeFileSync(join(root, "src", "app.tsx"), app);
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        jsxImportSource: FIXTURES,
        strict: false,
        skipLibCheck: true,
        noEmit: true,
        paths: { "@ramonda/core": [join(FIXTURES, "framework.ts")] },
      },
      include: ["src", join(FIXTURES, "framework.ts"), join(FIXTURES, "jsx-runtime.ts")],
    }),
  );

  return join(root, "tsconfig.json");
}

/** One component with three accessibility faults on one element, and a block among the attributes. */
const card = (attributes: string) => `import { Component } from "@ramonda/core";

export class Card extends Component {
  go() {}
  render() {
    return (
      <div>
        <img src="a.png" />
        <div ${attributes}>x</div>
      </div>
    );
  }
}
`;

const BLOCK = `css=@@( display: flex; )`;
const FAULTS = `onclick={this.go} role="button" tabindex={5}`;

/** Which rules found something, so a test names behaviour rather than counting. */
const found = (tsconfig: string) =>
  Object.entries(analyzeProject(tsconfig).findings)
    .filter(([, issues]) => (issues as unknown[]).length > 0)
    .map(([id]) => id)
    .sort();

describe("a block among the attributes", () => {
  /**
   * The three the fixture is built to trip. Named rather than counted, so a rule that stops firing
   * for its own reasons is a different failure from the parser going blind.
   */
  const EXPECTED = ["half-built-keyboard-path", "positive-tabindex", "unnamed-image"];

  test("the rules see past it, wherever in the attribute list it is", () => {
    expect(found(project(card(`${BLOCK} ${FAULTS}`)))).toEqual(EXPECTED);
    expect(found(project(card(`${FAULTS} ${BLOCK}`)))).toEqual(EXPECTED);
  });

  /**
   * The control, and it is the whole point of the pair: the same faults on the same element with no
   * block at all. Without it, a run finding three things would look identical to a run finding three
   * things for the wrong reason.
   */
  test("and the answer is the same one a project with no block gets", () => {
    expect(found(project(card(FAULTS)))).toEqual(EXPECTED);
  });

  test("a block with a hole in it is read too, expression and all", () => {
    const app = `import { Component } from "@ramonda/core";

export class Card extends Component {
  accent = "#10b981";
  go() {}
  render() {
    return (
      <div>
        <img src="a.png" />
        <div css=@@( border-left: 4px solid {{this.accent}}; ) ${FAULTS}>x</div>
      </div>
    );
  }
}
`;

    expect(found(project(app))).toEqual(EXPECTED);
  });

  test("several blocks in one file, and one of them nested", () => {
    const app = `import { Component } from "@ramonda/core";

export class Card extends Component {
  go() {}
  render() {
    return (
      <div css=@@( display: grid; )>
        <img src="a.png" />
        <span css=@@( color: red; &:hover { color: blue; } ) ${FAULTS}>x</span>
      </div>
    );
  }
}
`;

    expect(found(project(app))).toEqual(EXPECTED);
  });
});

describe("a block that is half written", () => {
  /**
   * The tolerant reading, and the reason it is the right one here: a checker's job is to report what
   * it can see, and `disp` in somebody's buffer is not a reason to stop analysing the file it is in.
   * Whether the block itself is well formed is `ramonda-css`'s answer, and that is the one that fails
   * a build.
   */
  test("does not stop the rest of the file being read", () => {
    const app = `import { Component } from "@ramonda/core";

export class Card extends Component {
  go() {}
  render() {
    return (
      <div>
        <img src="a.png" />
        <div css=@@( disp ) ${FAULTS}>x</div>
      </div>
    );
  }
}
`;

    expect(found(project(app))).toEqual(["half-built-keyboard-path", "positive-tabindex", "unnamed-image"]);
  });
});

describe("what the overlay does not touch", () => {
  test("a project with no block at all is read exactly as it was", () => {
    const app = `import { Component } from "@ramonda/core";

export class Plain extends Component {
  render() {
    return <img src="a.png" />;
  }
}
`;

    expect(found(project(app))).toEqual(["unnamed-image"]);
  });

  test("and a file whose `@(` is a decorator is not rewritten", () => {
    // `@(expr)` is already valid TypeScript in decorator position, and this is a decorator-heavy
    // framework — so the cheap scan says maybe and the real one has to say no.
    const app = `import { Component, state } from "@ramonda/core";

const dec = (value: unknown, context: unknown) => value;

export class Card extends Component {
  @(dec) label = "x";
  @state count = 0;
  render() {
    return <img src="a.png" />;
  }
}
`;

    expect(found(project(app))).toEqual(["unnamed-image"]);
  });
});
