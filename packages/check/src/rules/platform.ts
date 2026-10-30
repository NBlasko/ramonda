import type ts from "typescript";
import type { Resolver } from "./rule";

/**
 * Whether a name is the platform's: in one of TypeScript's lib files or the DOM's stand-ins — see
 * `createProgram` in `analyze.ts` — or declared nowhere, as in a program a caller of
 * `analyzeProgram` built with no lib. All three answer the same, so a rule says the same thing
 * whichever program it is handed.
 */
export function fromThePlatform(declared: ts.Declaration | undefined): boolean {
  if (declared === undefined) return true;
  const file = declared.getSourceFile().fileName;
  return file === DOM_STUB_FILE || TYPESCRIPT_LIB.test(file);
}

/**
 * `fromThePlatform`, asked of a name: `Boolean`, `setInterval`, `location`, `process` the platform
 * owns, and not a `const location = …` or a `declare const process` the source writes for itself.
 */
export function namesThePlatform(name: ts.Node, resolve: Resolver): boolean {
  // Declared nowhere is the platform's too: `every` holds of an empty list.
  return (resolve(name)?.declarations ?? []).every((declared) => fromThePlatform(declared));
}

/** Where the DOM's stand-ins sit in a program that reads types — a file no disk holds. */
export const DOM_STUB_FILE = "/__ramonda-check__/dom-stub.d.ts";

/** `…/typescript/lib/lib.dom.d.ts` — one of TypeScript's own lib files, whichever copy the project has. */
const TYPESCRIPT_LIB = /[\\/]typescript[\\/]lib[\\/]lib\.[^\\/]+\.d\.ts$/;

/**
 * One of TypeScript's own DOM lib files — `lib.dom.d.ts`, `lib.dom.iterable.d.ts`,
 * `lib.dom.asynciterable.d.ts` — read as one of `TYPESCRIPT_LIB`, so the two never disagree on a file.
 */
export function isTheDomLib(file: string): boolean {
  return TYPESCRIPT_LIB.test(file) && /[\\/]lib\.dom(\.[a-z]+)?\.d\.ts$/.test(file);
}
