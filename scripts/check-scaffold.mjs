/**
 * Scaffolds a project from THIS working tree and builds it, the way a user would.
 *
 * ## Why this exists
 *
 * Nothing else in this repository does it, and that gap has cost more shipped bugs than any
 * other. Every one of these reached a released package, and not one was visible to `pnpm check`:
 *
 * - `ramonda-check` refused the SSR template's own `createRouter` destructure, so a scaffolded
 *   routed project could not run `npm run build` at all — exit 1, empty `dist`.
 * - `scripts/prerender.mjs` imported jsdom while the scaffolder installed linkedom. The project
 *   type-checked, bundled both halves, and died on `ERR_MODULE_NOT_FOUND` at the last step.
 * - The template rendered with `renderToString`, which returns the body and nothing else, so every
 *   generated project shipped pages with no title and no description.
 * - `linkedom` sat in `devDependencies` while `server.mjs` needed it to start, so `npm ci
 *   --omit=dev` produced a project that installed, built, and then failed on the first request.
 * - `fillDocument` took an empty title literally and emitted `<title></title>`.
 *
 * The gate could not see any of them: it runs `ramonda-check` over `apps/docs` only, and the
 * scaffolder's own tests read template files as TEXT. A template is not source in this repository
 * — it is data — so the only way to know it works is to run it.
 *
 * ## Why tarballs and not the registry
 *
 * Installing from npm tests what already SHIPPED. This packs the working tree, so it tests what is
 * about to. The two answer different questions and only the second one can fail a pull request.
 *
 * The `@ramonda/*` packages depend on each other through PEER dependencies, so a project holding
 * `@ramonda/core` as a `file:` tarball satisfies `@ramonda/router`'s peer with that same copy —
 * there is no path by which a published version sneaks into this run.
 *
 * Usage: node scripts/check-scaffold.mjs [spa|ssr]
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] === "spa" ? "spa" : "ssr";

/**
 * `SELFTEST=<fault>` plants that fault in the GENERATED project and passes only if this check
 * reports it — the same shape `check-side-effects.mjs` uses, and for the same reason.
 *
 * A check nobody has seen fail is a check nobody knows still works. This one is especially prone
 * to going quiet: it asserts on strings in emitted HTML, and a template rewrite that changed a
 * marker or a selector would leave every assertion vacuously true.
 */
const selftest = process.env.SELFTEST;
const PLANTED = {
  // Deletes the shell's head marker, so the head has nowhere to land and the marker survives.
  head: { where: "index.html", expect: "the head never reached the HTML" },
  // Removes the marker the app itself lands in, so the page ships with no app.
  app: { where: "index.html", expect: "carries no rendered app" },
};
if (selftest !== undefined && PLANTED[selftest] === undefined) {
  console.error(`[scaffold] SELFTEST=${selftest} is not one of: ${Object.keys(PLANTED).join(", ")}`);
  process.exit(2);
}

/** Everything a generated project resolves to this workspace rather than to npm. */
const FIRST_PARTY = ["core", "router", "server", "check", "build"];

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: "pipe", ...options });
}

function fail(what, detail) {
  if (selftest !== undefined) {
    const expected = PLANTED[selftest].expect;
    if (what.includes(expected)) {
      console.log(`[scaffold] SELFTEST=${selftest}: reported it — "${what}"`);
      process.exit(0);
    }
    console.error(`[scaffold] SELFTEST=${selftest}: failed for the WRONG reason.`);
    console.error(`  expected a message containing: ${expected}`);
    console.error(`  got: ${what}`);
    process.exit(1);
  }
  console.error(`\n[scaffold] ${what}`);
  if (detail) console.error(detail.trim().split("\n").slice(-25).join("\n"));
  process.exit(1);
}

/**
 * Starts the built server and asks it for pages, because "it built" is not "it runs".
 *
 * A dynamic route as well as the baked one: they take different paths through the server — a file
 * read versus a live render — and only the second one needs the DOM, the router and everything a
 * production install might have dropped.
 */
async function serves(port = 5100 + Math.floor(Math.random() * 400), attempt = 0) {
  const server = spawn(process.execPath, ["server.mjs", "--prod"], {
    cwd: app,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));

  try {
    const get = async (path) => {
      // Waits for the port rather than sleeping: a cold Node start on a loaded CI runner is not
      // fast, and a fixed sleep is either flaky or wasteful.
      for (let tries = 0; tries < 100; tries++) {
        if (server.exitCode !== null) {
          // A port this machine was already using is not a fault in the generated project. Twice,
          // then it is something else and worth reporting.
          if (log.includes("EADDRINUSE") && attempt < 2) return "retry";
          fail(`the generated server exited with ${server.exitCode} before answering`, log);
        }
        try {
          const response = await fetch(`http://localhost:${port}${path}`);
          return { status: response.status, body: await response.text() };
        } catch {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      fail(`the generated server never answered on ${path}`, log);
    };

    for (const path of ["/", "/hello/world"]) {
      const answer = await get(path);
      if (answer === "retry") return "retry";
      const { status, body } = answer;
      if (status !== 200) fail(`the generated server answered ${status} for ${path}`, log);

      // The head on the LIVE path too, not only in the baked file. They are rendered by different
      // functions — `renderStatic` bakes, `renderPage` serves — and a project once shipped with
      // the second one dropping the head while the first kept it. Checking one proves nothing
      // about the other.
      const title = /<title>([^<]*)<\/title>/.exec(body)?.[1] ?? "";
      if (title.trim() === "") fail(`${path} was served with an empty <title>`, body.slice(0, 400));
      for (const marker of ["<!--ssr-->", "<!--head-->", "<!--portals-->"]) {
        if (body.includes(marker)) fail(`${path} was served still containing ${marker}`);
      }
    }

    // And the dynamic route's title is ITS OWN, not the layout's — which is what says the head a
    // per-request render produced actually travelled.
    const greeting = await get("/hello/world");
    if (greeting === "retry") return "retry";
    if (!/<title>[^<]*world[^<]*<\/title>/.test(greeting.body)) {
      fail("the dynamic route was served without its own title", greeting.body.slice(0, 400));
    }
  } finally {
    server.kill("SIGTERM");
  }
  return "served";
}

/** Retries once on a port this machine was already using; anything else is the project's fault. */
async function servesSomewhere() {
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await serves(undefined, attempt)) === "served") return;
  }
  fail("could not find a free port to serve the generated project on");
}

const work = mkdtempSync(join(tmpdir(), "ramonda-scaffold-check-"));
const packed = join(work, "packed");
const app = join(work, "app");

try {
  /* ── 1. pack the working tree ─────────────────────────────────────────────────────────────── */
  // `npm pack` reads `files`, so this is the exact tarball a publish would push — including the
  // mistake of forgetting to list a file, which is itself a fault this can catch.
  mkdirSync(packed, { recursive: true });
  const tarballs = new Map();
  for (const name of FIRST_PARTY) {
    const dir = join(repo, "packages", name);
    // `--json`, so the filename is REPORTED rather than reconstructed from the package name. The
    // scoped-name mangling npm does is its business, not something to reimplement here and get
    // subtly wrong the day it changes.
    const packedJson = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", packed], { cwd: dir }));
    const file = packedJson[0]?.filename;
    if (!file) fail(`npm pack produced no tarball in ${dir}`);
    tarballs.set(packedJson[0].name, join(packed, file));
  }

  /* ── 2. scaffold, with the scaffolder this tree builds ────────────────────────────────────── */
  const cli = join(repo, "packages", "create-ramonda", "dist", "index.js");
  if (!existsSync(cli)) fail("create-ramonda is not built — run `pnpm --filter create-ramonda build` first");
  const scaffolder = `
    import { scaffold } from ${JSON.stringify(cli)};
    scaffold({ targetDir: ${JSON.stringify(app)}, name: "scaffold-check", mode: ${JSON.stringify(mode)}, addons: [] });
  `;
  run(process.execPath, ["--input-type=module", "-e", scaffolder]);

  if (selftest !== undefined) {
    const file = join(app, PLANTED[selftest].where);
    const source = readFileSync(file, "utf8");
    const broken = selftest === "head" ? source.replace("<!--head-->", "") : source.replace("<!--ssr-->", "");
    if (broken === source) {
      console.error(`[scaffold] SELFTEST=${selftest}: could not plant the fault in ${PLANTED[selftest].where}`);
      process.exit(2);
    }
    writeFileSync(file, broken);
  }

  /* ── 3. point its first-party deps at the tarballs ────────────────────────────────────────── */
  const manifest = join(app, "package.json");
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  let rewritten = 0;
  for (const section of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(pkg[section] ?? {})) {
      const tarball = tarballs.get(name);
      if (tarball === undefined) continue;
      pkg[section][name] = `file:${tarball}`;
      rewritten++;
    }
  }
  // A guard on the guard: a run that rewrote nothing would be testing the published packages and
  // reporting a pass for code that is not in this tree.
  if (rewritten === 0) fail(`the generated ${mode} project names no @ramonda/* package to test`);
  writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`);

  /* ── 4. install and build, exactly as a reader would ──────────────────────────────────────── */
  try {
    run("npm", ["install", "--no-audit", "--no-fund"], { cwd: app });
  } catch (error) {
    fail("`npm install` failed in the generated project", String(error.stdout ?? error.stderr ?? error));
  }

  let built;
  try {
    built = run("npm", ["run", "build"], { cwd: app });
  } catch (error) {
    fail("`npm run build` failed in the generated project", String(error.stdout ?? error.stderr ?? error));
  }

  /* ── 5. what the build EMITTED, not just that it exited 0 ─────────────────────────────────── */
  // Three of the faults above left the build perfectly green. A page with no title is not an
  // error anywhere — it is a page nobody can find.
  const checks = [];
  if (mode === "ssr") {
    const baked = join(app, "dist/static/index.html");
    if (!existsSync(baked)) fail("the build produced no dist/static/index.html");
    const html = readFileSync(baked, "utf8");

    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
    if (title.trim() === "")
      fail("the baked page has an empty <title> — the head never reached the HTML", html.slice(0, 400));
    if (!html.includes('name="description"')) {
      fail('the baked page carries no <meta name="description"> — the head never reached the HTML');
    }
    // The app is IN the file. A shell that lost its `<!--ssr-->` still produces a valid page with
    // a title and a description — and nothing in it. The state attribute is the structural proof:
    // it is written per component during the render, so it cannot be there unless the app was.
    if (!html.includes("data-ramonda-state")) {
      fail("the baked page carries no rendered app — no hydration state in it", html.slice(0, 400));
    }

    // Left behind by a shell whose markers nothing filled.
    for (const marker of ["<!--ssr-->", "<!--head-->", "<!--portals-->"]) {
      if (html.includes(marker)) fail(`the baked page still contains ${marker}, so nothing filled it`);
    }
    checks.push(`title "${title}"`, "a description");
  } else {
    const index = join(app, "dist/index.html");
    if (!existsSync(index)) fail("the build produced no dist/index.html");
    checks.push("an index");
  }

  /* ── 6. a PRODUCTION install, and a page served from it ───────────────────────────────────── */
  if (mode === "ssr") {
    // `--omit=dev` is the whole point of this step: a package the server needs at RUNTIME, filed
    // under devDependencies, installs and builds and then fails on the first request. That
    // shipped, and nothing but starting the thing could have caught it.
    try {
      run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: app });
    } catch (error) {
      fail(
        "`npm ci --omit=dev` failed — a production install of the generated project",
        String(error.stdout ?? error.stderr ?? error),
      );
    }
    await servesSomewhere();
    checks.push("a production install that serves");
  }

  if (selftest !== undefined) {
    console.error(`[scaffold] SELFTEST=${selftest}: the fault was planted and this check PASSED anyway.`);
    process.exit(1);
  }

  console.log(
    `[scaffold] ${mode}: ${rewritten} workspace package(s), installed, built, and it has ${checks.join(", ")}`,
  );
  void built;
} finally {
  rmSync(work, { recursive: true, force: true });
}
