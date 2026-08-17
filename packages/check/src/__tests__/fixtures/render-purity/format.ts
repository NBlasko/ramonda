/** A utility in ANOTHER FILE, so the walk has an import to follow. */
export function stampedLabel(label: string): string {
  // The whole reason this fixture has two files: the clock is three names away from `render()`.
  return `${label} @ ${Date.now()}`;
}

/** Deterministic, and reached the same way — so silence here is what says the walk is precise. */
export function plainLabel(label: string): string {
  return label.trim();
}
