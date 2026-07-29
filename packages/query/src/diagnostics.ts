/**
 * The query package's own reporting, deduplicated by message.
 *
 * Separate from core's `diagnose` because these codes are this package's (`RMQ*`), and
 * because a cache diagnostic has no component to attribute itself to — what identifies it is
 * the key. Same shape otherwise: DEV only at every call site, one report per distinct cause,
 * and a reset for tests.
 */
const reported = new Set<string>();

export function warnOnce(message: string): void {
  if (reported.has(message)) return;
  reported.add(message);
  console.error(message);
}

/** Clears the dedup set. For tests, mirroring core's `resetDiagnostics`. */
export function resetQueryDiagnostics(): void {
  reported.clear();
}
