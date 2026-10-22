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

let seen = 0;
/** A helper held in a `const`, not pure: it counts. */
const countedArrow = (c: string) => {
  seen++;
  return c;
};
/** Not pure: hands on a `const` arrow that counts. */
export const handsOnAnArrow = (next: string) => next.split("").map(countedArrow).join("");

/** A factory handed a function, which its function then hands on. */
export function mapped(each: (c: string) => string) {
  return (next: string) => next.split("").map(each).join("");
}
/** Not pure: the factory was handed a function, which is not a fixed value. */
export const mappedWithAnArrow = mapped((c) => c);

const GLOBAL_DIGITS = /^\d*$/g;
/** Not pure: a `/g` expression keeps `lastIndex` from one call to the next. */
export const globalDigits = (next: string, prev: string) => (GLOBAL_DIGITS.test(next) ? next : prev);

/** Not pure: `Date()` called bare reads the clock. */
export const dated = (next: string, prev: string) => (Date().endsWith("2026") ? next : prev);

/** Changes the array it was handed — the caller's. */
function emptied(list: string[]): string[] {
  list.splice(0);
  return list;
}
/** Not pure: a helper it calls changes what its parameter holds. */
export const throughAHelperThatEmpties = (next: string) => (emptied([next]).length === 0 ? next : "");

/** Not pure: writes into what it was handed, under another name. */
export const throughAnAlias = (next: string, _prev: string, input: { selectionStart: number | null }) => {
  const i = input;
  i.selectionStart = 0;
  return next;
};

/** Not pure: deletes from what it was handed. */
export const deleting = (next: string, _prev: string, input: { inputType?: string }) => {
  delete input.inputType;
  return next;
};

/** Not pure: an arm of a conditional is the caller's array, and it pushes into it. */
export const pushesThroughAnArm = (next: string[], prev: string[]) => {
  const list = prev.length ? prev : [];
  list.push(next[0]);
  return list;
};
