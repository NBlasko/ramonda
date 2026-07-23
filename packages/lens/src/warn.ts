/**
 * DEV-only diagnostics.
 *
 * Deliberately NOT deduplicated. Core's lint dedupes because it fires once per
 * render for a fixed piece of code, so the second message carries nothing new.
 * A missed path here is data-dependent: the same call site can miss for one
 * record and hit for the next, and collapsing those would hide the case that
 * actually matters. Repetition is the signal.
 */
export function warn(message: string): void {
  console.warn(`[Ramonda lens] ${message}`);
}
