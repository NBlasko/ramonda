import type { Effect } from "../reactivity/effect";
import type { State } from "./State";

export const reactivityScope: {
  currentEffect: Effect | null;
} = {
  currentEffect: null,
};

export const trackerContainer: {
  current: { addDep: (s: State<unknown>) => void } | null;
} = {
  current: null,
};

/**
 * Records one signal against whatever is reading right now.
 *
 * There are TWO scopes and a reader can be in either — an effect
 * (`currentEffect`) or a tracker (`trackerContainer`: another `@compute`, a list
 * item, a hook's props cache) — so "who depends on this" is this function, and
 * nowhere else.
 *
 * It exists as a function because it has a second caller. `State.get` is the
 * obvious one, but a `@compute` on a cache HIT touches no signal at all: it hands
 * back a value and forwards its own deps to the reader instead. That forwarding
 * fed only the tracker, so an effect reading a fresh compute subscribed to
 * nothing and never re-ran — the ordering that produces it is the ordinary one,
 * since render fills the cache and effects flush after the commit. Both callers
 * now go through here, so the two scopes cannot be served unevenly again.
 */
export function trackDependency(signal: State<unknown>): void {
  // Not recorded if the effect WROTE this signal during this run: an effect that
  // depended on what it just set would re-trigger itself forever.
  const currentEffect = reactivityScope.currentEffect;
  if (currentEffect && !currentEffect.mutated.has(signal)) {
    currentEffect.deps.add(signal);
  }

  trackerContainer.current?.addDep(signal);
}
