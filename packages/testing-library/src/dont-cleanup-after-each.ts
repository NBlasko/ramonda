import { disableAutoCleanup } from "./cleanup";

/**
 * Import this BEFORE `@ramonda/testing-library` to keep rendered trees mounted
 * between tests — typically from a setup file.
 *
 * Very few tests want this, and the ones that do usually want something else:
 * a leaked tree is still live, so its effects, timers and listeners keep running
 * and its ids collide with the next test's. If you reach for this, `cleanup()`
 * by hand at the end of the tests that need the tree to survive.
 */
disableAutoCleanup();
