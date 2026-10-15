import { disableFailOnDiagnostics } from "./diagnostics";

/**
 * Import this BEFORE `@ramonda/testing-library` to let development diagnostics pass a test —
 * typically from a setup file.
 *
 * Rarely what you want. A diagnostic is a fault the page survives, and a passing test hides its
 * console, so this is how a fault ships unseen. A test that exists to show one can allow it alone:
 * `allowDiagnostics("RMD020")`.
 */
disableFailOnDiagnostics();
