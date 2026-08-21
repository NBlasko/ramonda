import { Maps } from "./kinds";

export function makeCache(): Maps<string, number> {
  return new Maps<string, number>();
}

/** A chain — three hops before the value is built. */
export function level1(): Maps<string, number> {
  return level2();
}
function level2(): Maps<string, number> {
  return level3();
}
function level3(): Maps<string, number> {
  return new Maps<string, number>();
}

/** Hands back one it HOLDS: a stable reference, and still `{}` in the blob. */
const held = new Maps<string, number>();
export function heldCache(): Maps<string, number> {
  return held;
}
