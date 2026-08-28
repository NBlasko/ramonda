import { defineConfig, devices } from "@playwright/test";

/**
 * The tests that need a real browser, and only those.
 *
 * The jsdom suites run in seconds and cover what the DOM holds. What they cannot cover is what a
 * PERSON does to it: a caret that the platform moves when a value is assigned, and focus that a
 * node loses when it is picked up and put down. Both were measured in jsdom, agreed with, and then
 * needed a browser to be believed — and one of them was wrong in the browser for a reason jsdom
 * could never have shown (a button takes the focus when you press it, so there was nothing left in
 * the list to keep).
 *
 * So this suite stays SMALL on purpose. It is not a second copy of the unit tests in a slower
 * runner; it is the handful of claims that only a browser can settle. Anything that can be asserted
 * about the DOM belongs in `packages/core/src/__tests__`, where it runs in a second.
 *
 * ## It runs against what `build` produced
 *
 * `vite preview` serves `dist`, and nothing here builds it — CI does that in the step before. Run
 * it by hand and the suite reads whatever `dist` currently holds, which after a source change is
 * the previous answer to the question being asked. Build first.
 */
export default defineConfig({
  testDir: "./browser",
  // One browser, and headless. The claims here are about the platform's own behaviour — where a
  // caret lands, what holds the focus — which is the same across engines, so a matrix would buy
  // repetition rather than coverage. The CI job installs `chromium-headless-shell` alone, which is
  // what this resolves to; a headed run needs `playwright install chromium` first.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The built app, served the way it is shipped rather than through the dev server: a transform
  // that only happens in production is exactly the kind of thing this suite exists to catch.
  webServer: {
    command: "pnpm exec vite preview --port 4173 --strictPort",
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:4173",
    // Kept only when something fails, and uploaded from CI. A difference that shows up in a browser
    // and nowhere else is not one that re-reading the source explains, so the run has to keep its
    // own record of what it saw.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // A failure here is worth looking at rather than re-running: the retry that passes hides the one
  // real difference between jsdom and a browser this suite is here to find.
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
});
