/** A helper in ANOTHER FILE that builds a fresh object every call. */
export function makeConf(): { dense: boolean } {
  return { dense: true };
}

/** The same, but handing back one object it built once — not a fresh one. */
const SHARED = { dense: true };
export function sharedConf(): { dense: boolean } {
  return SHARED;
}

/** A helper that calls a helper that calls a helper — the literal is three files-worth of hops in. */
export function chainConf(): { dense: boolean } {
  return level2();
}
function level2(): { dense: boolean } {
  return level3();
}
function level3(): { dense: boolean } {
  return { dense: true };
}

/** Twelve hops deep — further than anyone writes on purpose, and still followed to the literal. */
export function deepConf(): { dense: boolean } {
  return deep2();
}
function deep2(): { dense: boolean } {
  return deep3();
}
function deep3(): { dense: boolean } {
  return deep4();
}
function deep4(): { dense: boolean } {
  return deep5();
}
function deep5(): { dense: boolean } {
  return deep6();
}
function deep6(): { dense: boolean } {
  return deep7();
}
function deep7(): { dense: boolean } {
  return deep8();
}
function deep8(): { dense: boolean } {
  return deep9();
}
function deep9(): { dense: boolean } {
  return deep10();
}
function deep10(): { dense: boolean } {
  return deep11();
}
function deep11(): { dense: boolean } {
  return deep12();
}
function deep12(): { dense: boolean } {
  return { dense: true };
}

/** Recursion: no value is ever handed back, and the walk terminates on the cycle guard. */
export function loopConf(): { dense: boolean } {
  return loopAgain();
}
function loopAgain(): { dense: boolean } {
  return loopConf();
}

/** A chain that ends at a held object, so the whole chain is a stable reference. */
export function chainShared(): { dense: boolean } {
  return sharedConf();
}

/** The same fresh object, written as an arrow instead of a function declaration. */
export const arrowConf = (): { dense: boolean } => ({ dense: true });

/** One path hands back the held object and the other builds a fresh one. */
export function maybeConf(dense: boolean): { dense: boolean } {
  if (!dense) return SHARED;
  return { dense };
}
