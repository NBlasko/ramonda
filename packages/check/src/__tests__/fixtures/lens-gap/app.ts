import { focusOn } from "@ramonda/lens";
import { focusOn as lens } from "@ramonda/lens";
import { focusOn as ourOwn } from "./own-focus";
import type { AppState, Profile } from "./state";

declare const state: AppState;

/** ✗ `profile` is optional and the path continues into `name`. */
export function renameThroughAnOptional(): void {
  focusOn(state).get("profile").get("name").set("Ada");
}

/** ✗ `settings` is `| null` and the path continues into `theme`. */
export function themeThroughANull(): void {
  focusOn(state).get("settings").get("theme").set("dark");
}

/** ✗ A gap two hops in, with everything before it present — `address` is optional, `city` is past it. */
export function cityThroughANestedOptional(): void {
  focusOn(state).get("account").get("owner").get("address").get("city").set("Belgrade");
}

/**
 * ✗ Two gaps on one path, and the FIRST is the one reported.
 *
 * `settings` is `| null` and `layout` is optional. Reporting both would be reporting the same fix
 * twice: there is one path here, and it stops at the first hop that may be missing.
 */
export function columnsThroughTwoGaps(): void {
  focusOn(state).get("settings").get("layout").get("columns").set(3);
}

/** ✓ The gap IS the last hop, so the lens creates it. */
export function writeTheWholeProfile(): void {
  focusOn(state).get("profile").set({ name: "Ada", nickname: null });
}

/** ✓ Same, written as a merge. */
export function mergeTheWholeProfile(): void {
  focusOn(state).get("profile").merge({ name: "Ada" });
}

/** ✓ Proven present by an `if`. */
export function guardedByAnIf(): void {
  if (state.profile) {
    focusOn(state).get("profile").get("name").set("Ada");
  }
}

/** ✓ Proven by a comparison. */
export function guardedByNotNull(): void {
  if (state.settings !== null) {
    focusOn(state).get("settings").get("theme").set("dark");
  }
}

/** ✓ Proven by the loose comparison, which rules out both. */
export function guardedByLooseNotNull(): void {
  if (state.profile != null) {
    focusOn(state).get("profile").get("name").set("Ada");
  }
}

/** ✓ Proven by an early return — the shape a plain function is actually written in. */
export function guardedByAnEarlyReturn(): void {
  if (!state.profile) return;
  focusOn(state).get("profile").get("name").set("Ada");
}

/** ✓ Proven by the left of an `&&`. */
export function guardedByAnAnd(): void {
  state.profile && focusOn(state).get("profile").get("name").set("Ada");
}

/** ✓ Proven in the chosen arm of a ternary. */
export function guardedByATernary(): string {
  return state.profile ? String(focusOn(state).get("profile").get("name").set("Ada")) : "none";
}

/** ✓ Proven by the ELSE of a refutation. */
export function guardedByAnElse(): void {
  if (state.profile === undefined) {
    return;
  } else {
    focusOn(state).get("profile").get("name").set("Ada");
  }
}

/** ✗ A guard on the WRONG path proves nothing about this one. */
export function guardedByTheWrongPath(other: { profile?: Profile }): void {
  if (other.profile) {
    focusOn(state).get("profile").get("name").set("Ada");
  }
}

/**
 * ✗ A gap PAST a guarded gap, which is what makes the union worth unwrapping.
 *
 * `profile` is proven present by the `if`, so the walk carries on through it — and `address` past
 * it is optional with `city` beyond that. Continuing the walk means reading `Profile | undefined`
 * as `Profile`, and a walk that stopped at the union would be silent here.
 */
export function cityPastAGuardedGap(): void {
  if (state.profile) {
    focusOn(state).get("profile").get("address").get("city").set("Belgrade");
  }
}

/**
 * ✗ A gap past a guarded `| null`, which is the shape that needs the union unwrapped.
 *
 * `profile?: Profile` is an optional property whose annotation is not a union at all, so walking
 * past it needs nothing. `settings: Settings | null` does: continuing into it means reading the one
 * arm that is not the gap, and a walk that handed the union on would find no members and go quiet.
 */
export function columnsPastAGuardedNull(): void {
  if (state.settings) {
    focusOn(state).get("settings").get("layout").get("columns").set(3);
  }
}

/** ✓ A generic instantiation cannot be walked without substituting the argument, which is a type question. */
export function throughAGeneric(): void {
  focusOn(state).get("boxed").get("inner").get("name").set("Ada");
}

/** ✓ Nothing in the path is optional. */
export function throughPresentValues(): void {
  focusOn(state).get("account").get("owner").get("name").set("Ada");
}

/** ✓ `at` cannot be looked up as a property, so the walk stops without a word. */
export function throughAnArray(): void {
  focusOn(state).get("rows").at(0).get("name").set("Ada");
}

/** ✓ A computed key names no property this can find. */
export function throughAComputedKey(key: "profile"): void {
  focusOn(state).get(key).get("name").set("Ada");
}

/** ✓ A root with no written annotation: nothing to read the path against. */
export function throughAnInferredRoot(): void {
  const local = { profile: undefined as Profile | undefined };
  focusOn(local).get("profile").get("name").set("Ada");
}

/**
 * ✓ An app's own `focusOn`, imported under that exact name from its own module.
 *
 * Not the lens's, so not this rule's business — and the case a rule going by the written name gets
 * wrong. It is the same path as the first case in this file, so if the package check ever stops
 * working this is the line that says so.
 */
export function throughOurOwnFocusOn(): void {
  ourOwn(state).get("profile").get("name").set("Ada");
}

/** ✗ The lens's, under an ALIAS: the same binding, so the same report. */
export function throughAnAlias(): void {
  lens(state).get("profile").get("name").set("Ada");
}

/**
 * ✗ The INVERTED early return, and it is the strongest instance of the fault rather than an edge:
 * the line above proves the profile is gone from here down.
 */
export function afterAnEarlyReturnOnPresence(): void {
  if (state.profile) return;
  focusOn(state).get("profile").get("name").set("Ada");
}

/** ✗ The ELSE of a presence check is where the value is missing. */
export function inTheElseOfAPresenceCheck(): void {
  if (state.profile) {
    return;
  } else {
    focusOn(state).get("profile").get("name").set("Ada");
  }
}

/** ✗ The THEN of a refutation is where the value is missing. */
export function inTheThenOfARefutation(): void {
  if (!state.profile) {
    focusOn(state).get("profile").get("name").set("Ada");
  }
}

/** ✗ The FALSE arm of a ternary on presence — the same, written as an expression. */
export function inTheFalseArmOfATernary(): string {
  return state.profile ? "have it" : String(focusOn(state).get("profile").get("name").set("Ada"));
}

/**
 * ✓ A READ through a gap is documented behaviour, not a fault: `value()` answers `undefined` and
 * raises nothing. Only a chain that WRITES had to walk the path to build a new state.
 */
export function readThroughAGap(): string | undefined {
  return focusOn(state).get("profile").get("name").value();
}

/** ✓ The same for `values()`, which answers an empty array. */
export function readValuesThroughAGap(): string[] {
  return focusOn(state).get("profile").get("name").values();
}

/**
 * ✓ Optional chaining in the guard proves the hop is there: `state.profile?.name` can only be
 * truthy if the profile exists.
 */
export function guardedByOptionalChaining(): void {
  if (state.profile?.name) {
    focusOn(state).get("profile").get("name").set("Ada");
  }
}

/**
 * ✗ The same path under a COMPARISON proves nothing, and this is the boundary of the one above:
 * with no profile, `undefined !== null` is true and the guard lets the write through.
 */
export function comparedThroughOptionalChaining(): void {
  if (state.profile?.name !== null) {
    focusOn(state).get("profile").get("name").set("Ada");
  }
}

/** ✓ Truthiness spelled with the global `Boolean`. */
export function guardedByBoolean(): void {
  if (Boolean(state.profile)) {
    focusOn(state).get("profile").get("name").set("Ada");
  }
}

/** ✓ And spelled with a double negation. */
export function guardedByDoubleNegation(): void {
  if (!!state.profile) {
    focusOn(state).get("profile").get("name").set("Ada");
  }
}

/** ✓ The guard nested one block above the write — `guard-walk` climbs to it. */
export function guardedTwoBlocksUp(): void {
  if (state.profile) {
    for (const _ of [1]) {
      focusOn(state).get("profile").get("name").set("Ada");
    }
  }
}

/** ✓ The value read into a `const` first, which is how the guard is ordinarily written. */
export function guardedThroughALocal(): void {
  const profile = state.profile;
  if (profile) {
    focusOn(state).get("profile").get("name").set("Ada");
  }
}

/**
 * ✗ A `let` is not the same claim: it can be reassigned between the read and the guard, so its
 * truthiness is nobody's proof about the path.
 */
export function guardedThroughALet(): void {
  let profile = state.profile;
  profile = profile ?? { name: "x" };
  if (profile) {
    focusOn(state).get("profile").get("name").set("Ada");
  }
}

/**
 * ✓ A READ through a gap is documented behaviour, not a fault: `value()` answers `undefined` and
 * raises nothing. Only a chain that WRITES had to walk the path to build a new state.
 */
export function readThroughAGap(): string | undefined {
  return focusOn(state).get("profile").get("name").value();
}

/** ✓ The same for `values()`, which answers an empty array. */
export function readValuesThroughAGap(): string[] {
  return focusOn(state).get("profile").get("name").values();
}
