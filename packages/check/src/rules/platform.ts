import type ts from "typescript";

/**
 * Whether a name is the platform's: declared nowhere — the analyzer's own program has no lib — or in
 * one of TypeScript's lib files, which a program with a lib resolves it to. Both answer the same, so
 * a rule says the same thing whichever program it is handed.
 */
export function fromThePlatform(declared: ts.Declaration | undefined): boolean {
  if (declared === undefined) return true;
  return TYPESCRIPT_LIB.test(declared.getSourceFile().fileName);
}

/** `…/typescript/lib/lib.dom.d.ts` — one of TypeScript's own lib files, whichever copy the project has. */
const TYPESCRIPT_LIB = /[\\/]typescript[\\/]lib[\\/]lib\.[^\\/]+\.d\.ts$/;
