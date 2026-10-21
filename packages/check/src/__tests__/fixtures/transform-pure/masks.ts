/** Pure, in another file, calling a helper of its own. */
export function phoneMask(next: string, prev: string): string {
  const digits = next.replace(/\D/g, "");
  if (digits.length > 10) return prev;
  return grouped(digits);
}

function grouped(digits: string): string {
  return digits.replace(/(\d{3})(\d{3})(\d+)/, "$1-$2-$3");
}

/** A factory: the function it returns closes over `n`. */
export function maxLength(n: number) {
  return (next: string, prev: string) => (next.length <= n ? next : prev);
}

/** Made once, at the top of the module. */
export const max20 = maxLength(20);

let calls = 0;

/** Not pure: counts its calls in a module `let`. */
export function counted(next: string): string {
  calls++;
  return next;
}

/** Not pure: reads the clock. */
export function stamped(next: string): string {
  return Date.now() > 0 ? next : "";
}

/** Not pure: asks the network. */
export function fetched(next: string): string {
  fetch("/check");
  return next;
}

/** Not pure: hands on a function that counts. */
export function handsOn(next: string): string {
  return next.split("").map(counted).join("");
}

/** Not pure: writes into the object it was handed. */
export function marks(next: string, _prev: string, input: { inputType: string }): string {
  input.inputType = "seen";
  return next;
}

/** Pure: rebinds its own parameter, and fills an array it made. */
export function rebinds(next: string): string {
  next = next.trim();
  const out: string[] = [];
  out.push(next);
  return out.join("");
}

/** Not pure, one call down: the helper it calls reads the clock. */
export function viaHelper(next: string): string {
  return stamped(next).trim();
}

const blocked = new Set<string>();
/** Changes `blocked` — so a transform reading it depends on what else ran. */
export const block = (word: string) => blocked.add(word);
/** Not pure: reads a Set others change. */
export const noBlocked = (next: string, prev: string) => (blocked.has(next) ? prev : next);

const config = { max: 3 };
/** Not pure: reads a plain object, which anything holding it may change. */
export const configured = (next: string, prev: string) => (next.length <= config.max ? next : prev);

const LIMITS = Object.freeze({ max: 3 });
const DIGITS = /^\d*$/;
/** Pure: a frozen object of literals, and a regular expression. */
export const frozen = (next: string, prev: string) => (next.length <= LIMITS.max && DIGITS.test(next) ? next : prev);

let current = 20;
/** Not pure: made from a value that may change, which the function then reads. */
export const loose = maxLength(current);
