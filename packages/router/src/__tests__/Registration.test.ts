import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, test } from "vitest";

/**
 * The registered table, asked of WHOLE PROGRAMS — one per question, because a registration is global
 * to the program it is in, and this package's own type check carries the one `TypedRouter.test.tsx`
 * writes.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(SRC, "..", "..", "core", "src");

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** The errors a program of these files has, as `file: message` lines. */
function errorsOf(files: Record<string, string>): string[] {
  root = mkdtempSync(join(tmpdir(), "ramonda-register-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  const program = ts.createProgram(
    Object.keys(files)
      .filter((name) => !name.startsWith("node_modules/"))
      .map((name) => join(root, name)),
    {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "@ramonda/core",
      baseUrl: root,
      paths: {
        "@ramonda/router": [join(SRC, "index.ts")],
        "@ramonda/core": [join(CORE, "index.ts")],
        "@ramonda/core/jsx-runtime": [join(CORE, "jsx-runtime.ts")],
        "@ramonda/core/jsx-dev-runtime": [join(CORE, "jsx-dev-runtime.ts")],
      },
    },
  );
  return ts
    .getPreEmitDiagnostics(program)
    .filter((one) => one.file?.fileName.startsWith(root))
    .map(
      (one) =>
        `${one.file?.fileName.slice(root.length + 1)}: ${ts.flattenDiagnosticMessageText(one.messageText, "\n")}`,
    );
}

const TABLE = `import { createRoutes } from "@ramonda/router";
import { Home } from "./Home";
export const routes = createRoutes({ "/": <Home />, "/about": <Home />, "/users/:id": <Home /> });
`;
const REGISTER = `declare module "@ramonda/router" {
  interface Register {
    routes: typeof routes;
  }
}
`;

describe("a table registered once", () => {
  /**
   * Measured before the default was chosen: a default of the loose table accepted every href
   * SILENTLY and broke `params()` to `never`, so a forgotten registration looked exactly like a
   * correct app. The default refuses, and the refusal is the fix.
   */
  test("without a registration, the first link fails, and says what to write", () => {
    const errors = errorsOf({
      "routes.tsx": TABLE,
      "Home.tsx": `import { Component } from "@ramonda/core";
import { Link } from "@ramonda/router";
export class Home extends Component {
  render() { return <Link href="/about">About</Link>; }
}
`,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Home\.tsx: /);
    expect(errors[0]).toContain("declare module '@ramonda/router' { interface Register { routes: typeof routes } }");
    expect(errors[0]).not.toContain("\\");
  });

  test("registered, a page that imports only the package is checked against it", () => {
    const errors = errorsOf({
      "routes.tsx": TABLE + REGISTER,
      "Home.tsx": `import { Component } from "@ramonda/core";
import { Link, Navigator } from "@ramonda/router";
export class Home extends Component {
  route = this.use(Navigator);
  go() { this.route.push("/nope"); }
  render() {
    const { id } = this.route.params("/users/:id");
    return <div><Link href="/about">{id}</Link><Link href="/missing">x</Link></div>;
  }
}
`,
    });
    expect(errors.map((one) => one.split(": ")[1].slice(0, 40))).toEqual([
      `Argument of type '"/nope"' is not assign`,
      `Type '"/missing"' is not assignable to t`,
    ]);
  });

  /**
   * The reason for registering rather than a kit: a component published in a package names `Href`
   * in its `.d.ts`, and the APP's table checks what the app passes — where the app compiles it.
   */
  test("a package's component typed with `Href` is checked against the app's table", () => {
    const errors = errorsOf({
      "routes.tsx": TABLE + REGISTER,
      "node_modules/user-card/package.json": `{ "name": "user-card", "types": "index.d.ts" }`,
      "node_modules/user-card/index.d.ts": `import type { ComponentClassKind } from "@ramonda/core";
import type { Href } from "@ramonda/router";
export declare const UserCard: ComponentClassKind<{ href: Href }>;
`,
      "Home.tsx": `import { Component } from "@ramonda/core";
import { UserCard } from "user-card";
export class Home extends Component {
  render() { return <div><UserCard href="/users/7" /><UserCard href="/missing" /></div>; }
}
`,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`'"/missing"'`);
  });

  /**
   * A path the app works out — what `/routing/links` teaches. Built with `replace` it is a `string`
   * and refused; built from typed parts with `as const` it is a template type the table checks.
   */
  test("a path built from typed parts is checked; one built as a string is refused", () => {
    const errors = errorsOf({
      "routes.tsx": `import { createRoutes } from "@ramonda/router";
import { Home } from "./Home";
export const routes = createRoutes({ "/:lang/tournaments": <Home />, "/:lang/new": <Home /> });
${REGISTER}`,
      "Home.tsx": `import { Component } from "@ramonda/core";
import { Link } from "@ramonda/router";
type Lang = "sr" | "en";
type Page = "tournaments" | "new";
const other = (lang: Lang, page: Page) => \`/\${lang === "sr" ? "en" : "sr"}/\${page}\` as const;
export class Home extends Component {
  render() {
    const computed: string = "/sr/new".replace("/sr/", "/en/");
    return <div><Link href={other("sr", "new")}>ok</Link><Link href={computed}>refused</Link></div>;
  }
}
`,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("'string' is not assignable");
  });
});
