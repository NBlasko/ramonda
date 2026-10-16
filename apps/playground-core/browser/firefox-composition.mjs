/**
 * A word typed through an input method in Firefox, against the built playground.
 *
 * `fields.spec.ts` asks this of Chromium through the DevTools protocol's IME. Playwright cannot
 * compose in Firefox, so this drives Firefox's own `TextInputProcessor` — the API Mozilla's tests
 * use to type through an input method — over Marionette, from privileged code. The composition goes
 * through the same path a real input method does: measured, Firefox then sends `compositionend` and
 * an ordinary `input` with the word, which is why core sends nothing there.
 *
 * It is Playwright's own Firefox, so there is nothing more to install. It runs against `dist`, like
 * the spec: build first.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firefox } from "@playwright/test";

const PREVIEW = 4174;
const MARIONETTE = 2829;

/** What each handler must have taken: the word, once — and for `takes`, every step before it. */
const EXPECTED = {
  skips: '["日本"]',
  // Firefox's own events: the last composing `input` and the ordinary one after it both carry the
  // word. Core adds nothing, which is the claim.
  takes: '["n","に","日本","日本"]',
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Marionette speaks `length:json`; a command is `[0, id, name, params]`, a reply `[1, id, error, result]`. */
function marionette(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(port, "127.0.0.1");
    let buffer = Buffer.alloc(0);
    const pending = [];
    let id = 0;
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const colon = buffer.indexOf(":");
        if (colon < 0) return;
        const length = Number(buffer.subarray(0, colon).toString());
        if (buffer.length < colon + 1 + length) return;
        const message = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length).toString());
        buffer = buffer.subarray(colon + 1 + length);
        pending.shift()?.(message);
      }
    });
    socket.on("error", reject);
    // The first message is the server's greeting.
    pending.push(() =>
      resolve({
        send(name, params = {}) {
          const data = Buffer.from(JSON.stringify([0, ++id, name, params]));
          socket.write(`${data.length}:`);
          socket.write(data);
          return new Promise((done, fail) =>
            pending.push(([, , error, result]) =>
              error ? fail(new Error(`${name}: ${error.message}`)) : done(result),
            ),
          );
        },
        close: () => socket.destroy(),
      }),
    );
  });
}

async function connect() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await marionette(MARIONETTE);
    } catch {
      await wait(200);
    }
  }
  throw new Error("Firefox never opened Marionette");
}

/** Types 日本 into the focused field the way a Japanese input method does: `n`, `に`, then the word. */
const COMPOSE = `
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
  if (!tip.beginInputTransactionForTests(win)) throw new Error("no input transaction");
  for (const text of ["n", "に", "日本"]) {
    tip.setPendingCompositionString(text);
    tip.appendClauseToPendingComposition(text.length, tip.ATTR_RAW_CLAUSE);
    tip.flushPendingComposition();
  }
  tip.commitComposition();
`;

// Each in a process group of its own, and the GROUP is stopped: `pnpm exec` leaves `vite` running as a
// child when only `pnpm` is killed — measured, the preview kept its port after the first version.
const preview = spawn("pnpm", ["exec", "vite", "preview", "--port", String(PREVIEW), "--strictPort"], {
  stdio: "ignore",
  detached: true,
});
const profile = mkdtempSync(join(tmpdir(), "ramonda-firefox-"));
writeFileSync(join(profile, "user.js"), `user_pref("marionette.port", ${MARIONETTE});\n`);
const browser = spawn(
  firefox.executablePath(),
  ["--marionette", "-remote-allow-system-access", "--headless", "--no-remote", "--profile", profile],
  { stdio: "ignore", detached: true },
);
/** Stops a process group, and resolves once its leader has exited — or after five seconds. */
const stop = (child) =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(resolve, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });

let failed = false;
let session;
try {
  session = await connect();
  await session.send("WebDriver:NewSession", { capabilities: {} });
  for (const [id, expected] of Object.entries(EXPECTED)) {
    await session.send("Marionette:SetContext", { value: "content" });
    for (let attempt = 0; ; attempt++) {
      try {
        await session.send("WebDriver:Navigate", { url: `http://localhost:${PREVIEW}/fields` });
        break;
      } catch (error) {
        if (attempt > 50) throw error;
        await wait(200);
      }
    }
    await session.send("WebDriver:ExecuteScript", { script: `document.getElementById("${id}").focus();`, args: [] });
    await session.send("Marionette:SetContext", { value: "chrome" });
    await session.send("WebDriver:ExecuteScript", { script: COMPOSE, args: [] });
    await session.send("Marionette:SetContext", { value: "content" });
    // Read until the answer is in, rather than after a fixed pause a loaded runner may outlast: the
    // settle runs a task after the composition, and the readout a render after that.
    let field = "";
    let taken = "";
    for (let attempt = 0; attempt < 50; attempt++) {
      const { value } = await session.send("WebDriver:ExecuteScript", {
        script: `return [document.getElementById("${id}").value, document.getElementById("${id}-taken").textContent];`,
        args: [],
      });
      [field, taken] = value;
      if (field === "日本" && taken === expected) break;
      await wait(200);
    }
    const right = field === "日本" && taken === expected;
    if (!right) failed = true;
    console.log(
      `${right ? "✓" : "✘"} firefox › ${id}: field ${JSON.stringify(field)}, taken ${taken}${right ? "" : ` — expected ${expected}`}`,
    );
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await session?.send("Marionette:Quit", { flags: ["eForceQuit"] }).catch(() => {});
  session?.close();
  // Firefox writes to its profile until it has exited, so the profile goes after it.
  await stop(browser);
  await stop(preview);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch (error) {
    console.warn(`left the profile at ${profile}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
