// Diagnostics reach a collector during a REAL server render: the built bundle, no jsdom, no panel.
//
// ## What it proves, and what it deliberately does not
//
// It proves the SSR WIRING: that core's diagnostics reach a collector while a page is rendered on the
// server, through the same bundle `build:server` produces. Nothing else covers that — every hydration
// suite in `@ramonda/core` runs under jsdom, against source rather than a bundle.
//
// It does NOT prove the record path is DOM-free, and cannot: importing core with no DOM throws
// `ReferenceError: window is not defined` before any of its own code runs, because `debug/logger.ts`
// attaches a `ramonda:devtools-ready` listener at module scope in DEV. Measured. A DOM shim is a
// precondition for core in development, so this script installs linkedom like the server does.
//
// The DOM-free half of the protocol is `packages/lens/src/__tests__/NoDom.test.ts`, where it is really
// testable: lens's suite runs in vitest's `node` environment with no `window` at all, and a reporting
// package has no module-level DOM access to trip over.
//
// It cannot live in `@ramonda/core` either way. A `// @vitest-environment node` test that imports core's
// own source fails before reaching any code: `packages/core/vite.config.ts` defines `__DEV__` as an
// EXPRESSION (`process.env.NODE_ENV !== "production"`), and under `node` vitest hands `define` to
// esbuild, which accepts only a name or a literal.
//
// So it lives beside `prerender.mjs` and `smoke.mjs`, in the app whose purpose is dogfooding SSR, and it
// drives `diagnostics-fixture.tsx` — built with the same esbuild invocation as `build:server`, `__DEV__`
// on, the devtools import pointed at nothing, under linkedom.

import { installDom } from "../installDom.mjs";

const TAG = "[ssr-diagnostics]";

const fail = (message) => {
  console.error(`\n${TAG} ${message}\n`);
  process.exit(1);
};

/**
 * The sink goes on BEFORE the DOM and before the import, and the order is not cosmetic: class fields and
 * decorators run at import time, so a sink installed afterwards would miss anything reported while the
 * module was being evaluated.
 */
const records = [];
globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);

await installDom("http://localhost:5180/");

const { render } = await import("../dist/server/diagnostics-fixture.js");
const html = await render();

/* ── 1. they arrive at all, on the server ───────────────────────────────────────────────────────── */

if (records.length === 0) {
  fail(
    "No records reached the sink during a server render. The fixture raises three faults on purpose, so " +
      "zero means the emit in `packages/core/src/debug/diagnostics.ts` no longer runs on the server — a " +
      "guard that reads as client-only, or a sink read that moved behind one.",
  );
}

// Named codes rather than a count, so a fixture that stops raising one is a failure and not a smaller
// number nobody reads. RMD019 is the state write, RMD033 the serialize walk, RMD039 the `class` attribute.
const EXPECTED = ["RMD019", "RMD033", "RMD039"];
const seen = records.map((record) => record.code).sort();
const missing = EXPECTED.filter((code) => !seen.includes(code));
if (missing.length > 0) {
  fail(`Expected ${EXPECTED.join(", ")} from the fixture; missing ${missing.join(", ")}. Saw ${seen.join(", ")}.`);
}

/* ── 2. every record is serializable ───────────────────────────────────────────────────────────── */

// What a collector does with a record is ship it, and `JSON.stringify` throws on a `bigint` and on a
// cycle. `reportable` in core is what keeps `data` to primitives; this is the other end of that.
for (const record of records) {
  try {
    JSON.stringify(record);
  } catch (error) {
    fail(`${record.code} produced a record JSON.stringify refuses: ${error.message}`);
  }
}

/* ── 3. a use() label stays out of the hydration blob ──────────────────────────────────────────── */

// The label is a development-only devtools name. In the blob it would be state the client tries to
// restore, and the two sides would disagree about what a hook holds.
if (html.includes("signup")) {
  fail("The `use()` label reached the hydration blob. It is a devtools name, not state.");
}

// The blob rides the component's OPENING MARKER. It used to be an attribute on the component's host
// element, and there is no host: a component owns a range of nodes, so the address of its state is
// the comment in front of that range.
const blob = /<!--c\d+ (\{.*?\})-->/.exec(html);
if (!blob) fail("No hydration blob in the rendered HTML, so the assertion below would prove nothing.");

const decoded = blob[1];
// `value` is 10 rather than the seed: the hook moves it in `@created`, because core omits a field
// still holding its initial primitive and two EMPTY blobs would prove nothing about the label.
const EXPECTED_BLOB = '{"state":{},"hooks":[{"state":{"value":10}}]}';
if (decoded !== EXPECTED_BLOB) {
  fail(`The blob is ${decoded}, expected ${EXPECTED_BLOB} — a labelled hook must serialize like any other.`);
}

console.log(
  `${TAG} ${records.length} records reached the sink during a server render (${seen.join(", ")}), ` +
    `every one is JSON-serializable, and a labelled hook's blob is the same as an unlabelled one's.`,
);
