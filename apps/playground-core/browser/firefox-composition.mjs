/**
 * A word typed through an input method in Firefox, against the built playground.
 *
 * `fields.spec.ts` asks this of Chromium through the DevTools protocol's IME. Playwright cannot
 * compose in Firefox, so this drives Firefox's own `TextInputProcessor` — the API Mozilla's tests
 * use to type through an input method — over Marionette, from privileged code. The composition goes
 * through the same path a real input method does: measured, Firefox then sends `compositionend` and
 * an ordinary `input` with the word, which the field recognises as the word it already handed over.
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

/**
 * What each handler must have taken: a handler that waits for the finished word, the word once; one
 * that reads every input, each step — and Firefox's own `input` after the end, recognised as the word
 * the field already shows, adds nothing to either.
 */
const EXPECTED = {
  skips: '["日本"]',
  takes: '["n","に","日本"]',
  "skips-input": '["日本"]',
  "takes-input": '["n","に","日本"]',
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long one Marionette reply may take before the run fails rather than hangs. */
const REPLY = 30_000;

/** `promise`, or a failure naming `what` once `ms` have passed. */
const within = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, fail) => setTimeout(() => fail(new Error(`${what}: no answer in ${ms} ms`)), ms).unref()),
  ]);

/**
 * Marionette speaks `length:json`; a command is `[0, id, name, params]`, a reply `[1, id, error, result]`.
 *
 * Replies are matched to commands by their id, not by order: a command that timed out and answers
 * later must not hand its reply to the one after it. The first message, the greeting, is not a reply.
 */
function marionette(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(port, "127.0.0.1");
    let buffer = Buffer.alloc(0);
    let greeted = false;
    const waiting = new Map();
    let id = 0;
    const session = {
      send(name, params = {}) {
        const mine = ++id;
        const data = Buffer.from(JSON.stringify([0, mine, name, params]));
        socket.write(`${data.length}:`);
        socket.write(data);
        const reply = new Promise((done, fail) =>
          waiting.set(mine, ([, , error, result]) =>
            error ? fail(new Error(`${name}: ${error.message}`)) : done(result),
          ),
        );
        return within(reply, REPLY, name).finally(() => waiting.delete(mine));
      },
      close: () => socket.destroy(),
    };
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const colon = buffer.indexOf(":");
        if (colon < 0) return;
        const length = Number(buffer.subarray(0, colon).toString());
        if (buffer.length < colon + 1 + length) return;
        const message = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length).toString());
        buffer = buffer.subarray(colon + 1 + length);
        if (!greeted) {
          greeted = true;
          resolve(session);
        } else if (Array.isArray(message)) {
          waiting.get(message[1])?.(message);
        }
      }
    });
    socket.on("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

/**
 * Connects, within one deadline for the whole of it. Firefox takes a moment to open the port, so a
 * refused connection is tried again; a connection that opens and never greets is given up on, and
 * its socket closed, when the deadline passes — not retried for another full wait each time.
 */
async function connect() {
  const deadline = Date.now() + REPLY;
  while (Date.now() < deadline) {
    const attempt = marionette(MARIONETTE);
    try {
      return await within(attempt, Math.max(deadline - Date.now(), 1), "Marionette's greeting");
    } catch (error) {
      attempt.then((late) => late.close()).catch(() => {});
      if (/no answer/.test(error.message)) throw error;
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
    // The preview may not be listening yet: a refused page is tried again, a command that never
    // answers is not.
    for (let attempt = 0; ; attempt++) {
      try {
        await session.send("WebDriver:Navigate", { url: `http://localhost:${PREVIEW}/fields` });
        break;
      } catch (error) {
        if (attempt > 50 || /no answer/.test(error.message)) throw error;
        await wait(200);
      }
    }
    await session.send("WebDriver:ExecuteScript", { script: `document.getElementById("${id}").focus();`, args: [] });
    await session.send("Marionette:SetContext", { value: "chrome" });
    await session.send("WebDriver:ExecuteScript", { script: COMPOSE, args: [] });
    await session.send("Marionette:SetContext", { value: "content" });
    // Read until the answer is in, rather than after a fixed pause a loaded runner may outlast: the
    // readout is a render after the composition.
    const read = async () =>
      (
        await session.send("WebDriver:ExecuteScript", {
          script: `return [document.getElementById("${id}").value, document.getElementById("${id}-taken").textContent];`,
          args: [],
        })
      ).value;
    let field = "";
    let taken = "";
    for (let attempt = 0; attempt < 50; attempt++) {
      [field, taken] = await read();
      if (field === "日本" && taken === expected) break;
      await wait(200);
    }
    // And again once nothing more has come: a word handed over twice, the second time late, must not
    // pass on the first reading that looked right.
    await wait(500);
    [field, taken] = await read();
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
