/**
 * Takes the screenshots on `/devtools` by driving a real browser over the DevTools Protocol.
 *
 * ## Why generated rather than taken by hand
 *
 * A hand-taken screenshot of a devtools panel is out of date the first time the panel changes, and
 * nothing tells you: it is a picture, and pictures do not fail a build. These are produced from the
 * playground by a script, so regenerating them is one command, and a panel that no longer looks like
 * its documentation is a diff rather than a discovery.
 *
 * ## Why CDP and not Playwright
 *
 * Because it needs nothing installed. Chrome is on the machine, `ffmpeg` is on the machine, and Node
 * has had a global `WebSocket` since 22 — which is the whole dependency list for driving a browser and
 * turning frames into a GIF. Adding Playwright would mean a 100 MB browser download in a repo that
 * already has a browser, for a script that runs when the panel changes.
 *
 * ## Usage
 *
 *   node scripts/shots.mjs            # everything into public/devtools/
 *   node scripts/shots.mjs tree       # just one, by name
 *
 * It starts the playground itself and stops it again, so there is nothing to set up first.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, "..");
const repo = join(docs, "..", "..");
const playground = join(repo, "apps", "playground-core");
const out = join(docs, "public", "devtools");

/** The viewport the shots are taken at: wide enough for the app AND a docked panel beside it. */
const VIEWPORT = { width: 1400, height: 860, scale: 2 };

/**
 * What the images are written at, which is not what they are captured at.
 *
 * Captured at 2× so the panel's 13px monospace survives, then scaled to 1600 wide — twice the
 * documentation column, which is all a retina screen can use. Skipping this step is a 920 kB page for
 * pixels nobody sees.
 */
const OUTPUT_WIDTH = 1600;

const wanted = process.argv.slice(2);
const asked = (name) => wanted.length === 0 || wanted.includes(name);

/** A port the OS says is free, rather than a constant two runs could collide on. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(what, check, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    try {
      const answer = await check();
      if (answer) return answer;
    } catch {
      /* not up yet */
    }
    await wait(150);
  }
  throw new Error(`gave up waiting for ${what}`);
}

/* ── the browser ──────────────────────────────────────────────────────────────────────────── */

/**
 * A CDP session over one WebSocket.
 *
 * Thin on purpose: `send` returns a promise for its reply, and `on` takes events. Everything else in
 * this file is written in terms of `Runtime.evaluate`, because driving the panel from inside the page
 * is both simpler and closer to what a reader does than synthesising input events.
 */
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error(`could not open ${url}`)), { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (!waiter) return;
      if (message.error) waiter.reject(new Error(`${message.error.message} (${JSON.stringify(message.error.data)})`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params);
  });

  return {
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    on(method, listener) {
      const existing = listeners.get(method) ?? [];
      existing.push(listener);
      listeners.set(method, existing);
    },
    close: () => socket.close(),
  };
}

async function launchChrome(profileDir) {
  const port = await freePort();
  const chrome = spawn(
    "google-chrome",
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let noise = "";
  for (const stream of [chrome.stdout, chrome.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      noise += chunk;
    });
  }

  const target = await waitFor("chrome's debugger", async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return list.find((entry) => entry.type === "page");
  }).catch((error) => {
    chrome.kill("SIGKILL");
    throw new Error(`${error.message}\n\n--- chrome said ---\n${noise.trim()}`);
  });

  const session = await connect(target.webSocketDebuggerUrl);
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: VIEWPORT.scale,
    mobile: false,
  });

  return { session, stop: () => chrome.kill("SIGTERM") };
}

/* ── the page ─────────────────────────────────────────────────────────────────────────────── */

/** Runs an expression in the page and hands back its value, awaiting a promise if it is one. */
async function evaluate(session, expression) {
  const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(`the page threw: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  }
  return result.value;
}

/**
 * The panel, driven from inside the page.
 *
 * Every shot is composed by calling these — `open`, `tab`, `focus` — rather than by clicking at
 * coordinates, so a change to the panel's layout does not silently produce a picture of the wrong
 * thing. The one exception is the picker, which needs a real pointer.
 */
const PANEL = `const panel = document.querySelector("ramonda-devtools"); const root = panel.shadowRoot;`;

const drive = (session, body) => evaluate(session, `${PANEL}\n${body}`);

/**
 * Puts the page and the panel in a known state before a shot.
 *
 * Both halves are here because both bit. The panel PERSISTS its session — open, tab, focused component
 * — in `sessionStorage`, so a scene inherited whatever the one before it left behind; and `toggle()`
 * assumes it knows which way it is going, which is why the picker shot came out with the panel CLOSED
 * (the scene before it had left it open). A shot script whose output depends on the order its scenes
 * ran in produces a different picture every time.
 */
async function scene(session, url, { open = true } = {}) {
  await session.send("Page.navigate", { url: "about:blank" });
  await session.send("Page.navigate", { url });
  await waitFor("the app to mount", () => evaluate(session, `return !!document.querySelector("ramonda-devtools")`));
  // The panel arrives through a dynamic import, and the query demos resolve on a timer.
  await wait(1200);

  await drive(
    session,
    `sessionStorage.clear();
     localStorage.clear();
     const wanted = ${open};
     if (wanted !== panel.hasAttribute("open")) panel.toggle();`,
  );
  await wait(250);
}

/**
 * Captures a PNG and writes a WebP.
 *
 * The conversion is not a detail: a 2× PNG of this panel is 200–360 KB, and five of them plus a GIF is
 * a megabyte and a half on one documentation page. WebP at the same 2× is a fifth of that, which is the
 * difference between illustrating a page and making it slow. Retina detail is worth keeping — the panel
 * is mostly 13px monospace, and that is exactly what a 1× screenshot destroys.
 */
async function shoot(session, name, clip) {
  const { data } = await session.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    ...(clip ? { clip: { ...clip, scale: VIEWPORT.scale } } : {}),
  });

  const png = join(profileDir, `${name}.png`);
  writeFileSync(png, Buffer.from(data, "base64"));

  const webp = join(out, `${name}.webp`);
  const convert = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      png,
      "-vf",
      `scale=${OUTPUT_WIDTH}:-1:flags=lanczos`,
      "-quality",
      "80",
      "-compression_level",
      "6",
      webp,
    ],
    { encoding: "utf8" },
  );
  if (convert.status !== 0) throw new Error(`ffmpeg could not write ${name}.webp:\n${convert.stderr?.slice(-600)}`);

  const size = (statSync(webp).size / 1024).toFixed(0);
  console.log(`[shots] ${name}.webp (${size} kB)`);
}

/* ── the run ──────────────────────────────────────────────────────────────────────────────── */

const profileDir = join(process.env.TMPDIR ?? "/tmp", `ramonda-shots-${process.pid}`);
mkdirSync(out, { recursive: true });
mkdirSync(profileDir, { recursive: true });

const port = await freePort();
const server = spawn("npx", ["vite", "--port", String(port), "--strictPort"], {
  cwd: playground,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverNoise = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    serverNoise += chunk;
  });
}

const browser = { stop: () => {} };
try {
  await waitFor("the playground", async () => (await fetch(`http://localhost:${port}/`)).ok).catch((error) => {
    throw new Error(`${error.message}\n\n--- vite said ---\n${serverNoise.trim()}`);
  });

  const launched = await launchChrome(profileDir);
  browser.stop = launched.stop;
  const { session } = launched;

  if (asked("tree")) {
    await scene(session, `http://localhost:${port}/query`);
    await drive(
      session,
      `root.querySelector('.tab[data-tab="components"]').dispatchEvent(new Event("click"));
       await new Promise((r) => setTimeout(r, 300));
       const rows = [...root.querySelectorAll("[data-pin]")];
       const pick = rows.find((b) => b.dataset.pin.endsWith(":ProfileCard")) ?? rows.at(-1);
       pick.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));`,
    );
    await wait(400);
    await shoot(session, "tree");
  }

  if (asked("query")) {
    await scene(session, `http://localhost:${port}/query`);
    await drive(session, `root.querySelector('.tab[data-tab="query"]').dispatchEvent(new Event("click"));`);
    await wait(600);
    await shoot(session, "query");
  }

  if (asked("profile")) {
    /**
     * The table page, because the shot has to show the thing worth seeing: one change rebuilding a
     * row per item. The first version clicked "the first three buttons on the page" and hit the nav's
     * Back — the browser navigated away mid-shot and CDP answered "target navigated or closed", which
     * is a fair description of driving a page by ordinal.
     */
    await scene(session, `http://localhost:${port}/table`);
    await drive(
      session,
      `root.querySelector('.tab[data-tab="profile"]').dispatchEvent(new Event("click"));
       await new Promise((r) => setTimeout(r, 200));
       root.querySelector("#profile-record").dispatchEvent(new MouseEvent("click", { bubbles: true }));`,
    );

    /**
     * Two kinds of commit, on purpose, because the contrast is the whole point of the tab.
     *
     * Appending a row rebuilds ONE component — the page — because `list()` keeps each row's scope and
     * its DOM node. Toggling the theme rebuilds every consumer of that context. A screenshot with only
     * the first kind makes the panel look like it has nothing to say; with both, the numbers say what
     * the framework actually does.
     */
    await drive(
      session,
      `const byText = (text) =>
         [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
       for (let i = 0; i < 3; i++) {
         byText("append row")?.click();
         await new Promise((r) => setTimeout(r, 90));
       }
       byText("reverse")?.click();
       await new Promise((r) => setTimeout(r, 150));
       for (let i = 0; i < 2; i++) {
         byText("toggle theme")?.click();
         await new Promise((r) => setTimeout(r, 150));
       }`,
    );
    await wait(800);
    await shoot(session, "profile");
  }

  if (asked("value")) {
    /**
     * From the QUERY tab, because that is where a value worth opening lives.
     *
     * The first version opened whatever the components tab offered first and produced a full-panel
     * picture of `Array(1)` containing one string — a feature photographed doing nothing. A cached
     * payload is the case it exists for.
     */
    await scene(session, `http://localhost:${port}/table`);
    await drive(
      session,
      `root.querySelector('.tab[data-tab="components"]').dispatchEvent(new Event("click"));
       await new Promise((r) => setTimeout(r, 300));
       // A dozen rows of objects: deep enough that the tree is doing something, which a two-key
       // payload from a fake API is not. Chosen by SIZE rather than by name, so it survives the demo
       // being rewritten.
       for (let i = 0; i < 8; i++) {
         [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "append row")?.click();
         await new Promise((r) => setTimeout(r, 60));
       }
       await new Promise((r) => setTimeout(r, 400));
       const size = (button) => (root.querySelector('[data-sv="' + button.dataset.full + '"]')?.textContent.length ?? 0);
       const richest = [...root.querySelectorAll("[data-full]")].sort((a, b) => size(b) - size(a))[0];
       richest.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));`,
    );
    await wait(400);
    await shoot(session, "value");
  }

  /**
   * The picker needs a real pointer, so this is the one shot driven by input events rather than from
   * inside the page: the outline and the label only exist while something is genuinely hovered.
   */
  if (asked("picker")) {
    await scene(session, `http://localhost:${port}/table`);
    await drive(
      session,
      `root.querySelector('.tab[data-tab="components"]').dispatchEvent(new Event("click"));
       await new Promise((r) => setTimeout(r, 250));
       root.querySelector('[data-tool="pick"]').dispatchEvent(new Event("click"));`,
    );

    // Over a table cell, in CSS pixels — the coordinates come from the page rather than being guessed.
    const spot = await evaluate(
      session,
      `const cell = document.querySelector(".page table tbody tr:nth-child(2) td");
       if (!cell) return null;
       const box = cell.getBoundingClientRect();
       return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };`,
    );
    if (!spot) throw new Error("no table cell to point at");

    for (const step of [0, 1, 2]) {
      await session.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: spot.x + step,
        y: spot.y,
        buttons: 0,
      });
      await wait(120);
    }
    await wait(300);
    await shoot(session, "picker");
  }

  /**
   * The badge's detonation, as a GIF, because it is the one thing in the panel a still cannot show — a
   * burst and a count that settles.
   *
   * Frames come from `Page.startScreencast`, which pushes them as the compositor produces them, and
   * `ffmpeg` turns them into a palette-optimised GIF. The panel has to be CLOSED: an open one hides the
   * badge, and an error does not open the panel by design.
   */
  if (asked("badge")) {
    if (!spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0) {
      throw new Error("ffmpeg is needed for the badge GIF");
    }

    // Closed, because an open panel hides the badge — and an error does not open the panel by design.
    await scene(session, `http://localhost:${port}/diagnostics`, { open: false });

    /**
     * The badge is moved off the corner first, and that is not vanity: it lives at `bottom: 20px;
     * right: 20px`, and its rings expand to about three times its size — so against the viewport edge
     * the burst is clipped by the window itself, not merely by the crop. It is draggable, so this is
     * something a reader could do too.
     */
    await drive(
      session,
      `const badge = root.querySelector(".ramonda-badge");
       badge.style.right = "120px";
       badge.style.bottom = "120px";`,
    );
    await wait(200);

    const frameDir = join(profileDir, "frames");
    mkdirSync(frameDir, { recursive: true });

    let index = 0;
    session.on("Page.screencastFrame", async ({ data, sessionId }) => {
      writeFileSync(join(frameDir, `f${String(index++).padStart(4, "0")}.png`), Buffer.from(data, "base64"));
      await session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });

    await session.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
    // A beat of stillness first, so the GIF opens on the quiet badge rather than mid-animation.
    await wait(400);
    // Through the real path — the page's own button, which provokes RMD004.
    await drive(
      session,
      `const button = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("one error"));
       button.click();
       await new Promise((r) => setTimeout(r, 900));
       button.click();`,
    );
    // Long enough for the second burst to finish and settle into the breathing badge, and no longer:
    // every extra frame is weight on a documentation page.
    await wait(1500);
    await session.send("Page.stopScreencast");

    // Centred on where the badge now is, with room for the rings on every side.
    const badge = { x: VIEWPORT.width - 230, y: VIEWPORT.height - 230, w: 200, h: 200 };
    const crop = `crop=${badge.w * VIEWPORT.scale}:${badge.h * VIEWPORT.scale}:${badge.x * VIEWPORT.scale}:${
      badge.y * VIEWPORT.scale
    },scale=300:-1:flags=lanczos`;
    const gif = join(out, "badge.gif");
    const ffmpeg = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-framerate",
        "20",
        "-i",
        join(frameDir, "f%04d.png"),
        "-vf",
        `${crop},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer`,
        "-loop",
        "0",
        gif,
      ],
      { encoding: "utf8" },
    );
    if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed:\n${ffmpeg.stderr?.slice(-800)}`);
    console.log(`[shots] badge.gif (${index} frames, ${(statSync(gif).size / 1024).toFixed(0)} kB)`);
  }

  console.log("[shots] done");
} finally {
  browser.stop();
  server.kill("SIGTERM");
  rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
}
