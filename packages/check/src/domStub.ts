import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

/**
 * The DOM's names, each as a stand-in, for a program that reads types — see `createProgram` in
 * `analyze.ts`.
 *
 * Why stand-ins: one rule, `form-value-in-the-wrong-control`, asks a TYPE, through core's and the
 * form's declarations, which name `HTMLInputElement`, `Event` and the rest. The DOM lib that declares
 * them is 2.3 MB to parse for contents the answer never reads; its NAMES are all the answer needs.
 * Read from the DOM lib of the TypeScript this package runs, so they are always the names core's and
 * the form's declarations were written against — nothing here is kept by hand.
 *
 * Each interface and type is DISTINCT — an empty one is `{}`, everything is assignable to it, and the
 * form then took a whole schema for a `File` (measured): the answer collapsed to `any`. An interface
 * keeps the DOM interfaces it extends, so `HTMLInputElement` is still an `HTMLElement` where core's
 * types ask. A generic one keeps its arity, every parameter defaulted. A value keeps its type when
 * that is one of these names (`declare var document: Document`); a function takes anything.
 *
 * One member is kept, `HTMLFormElement.reset` — `MEMBERS` — so a form FITS a type with a `reset` of
 * its own, as it does in the browser: `reset-the-model-does-not-hear` asks whether a form fits the
 * value a `reset()` is called on (`const r: Resettable = form`, then `r.reset()`).
 */
export function domStub(): string {
  if (built === undefined)
    built = standInsFor(readFileSync(join(dirname(ts.getDefaultLibFilePath({})), "lib.dom.d.ts"), "utf8"));
  return built;
}

let built: string | undefined;

/** The members a stand-in keeps, by name — each one a rule asks about; see `domStub`. */
const MEMBERS: Readonly<Record<string, string>> = { HTMLFormElement: "reset(): void;" };

function standInsFor(lib: string): string {
  const types = new Map<string, number>();
  const aliases = new Set<string>();
  const bases = new Map<string, Set<string>>();
  for (const match of lib.matchAll(/^(?:declare )?(interface|type) (\w+)(<)?/gm)) {
    const [, kind, name, generic] = match;
    const after = match.index + match[0].length;
    const list = generic === undefined ? { count: 0, end: after } : parameters(lib, after - 1);
    if (!types.has(name)) types.set(name, list.count);
    if (kind === "type") aliases.add(name);
    const extended = /^ extends ([^{]+) \{/.exec(lib.slice(list.end, lib.indexOf("\n", list.end)))?.[1];
    if (kind === "interface" && extended !== undefined) {
      const known = bases.get(name) ?? new Set<string>();
      // Without its arguments: they name the original's parameters, which the stand-in renames.
      for (const base of topLevel(extended)) known.add(base.replace(/<.*$/s, ""));
      bases.set(name, known);
    }
  }
  const values = new Map<string, string>();
  for (const match of lib.matchAll(/^declare (var|function|namespace) (\w+)(?:: (\w+);)?/gm)) {
    const [, kind, name, type] = match;
    if (values.has(name)) continue;
    values.set(
      name,
      kind === "function"
        ? `declare function ${name}(...args: any[]): any;`
        : `declare var ${name}: ${type !== undefined && types.has(type) ? type : types.has(name) ? name : "any"};`,
    );
  }
  const declared = [...types].map(([name, count]) => {
    const parameters = count === 0 ? "" : `<${Array.from({ length: count }, (_, i) => `T${i} = any`).join(", ")}>`;
    const body = `{ readonly "stub:${name}": never;${MEMBERS[name] === undefined ? "" : ` ${MEMBERS[name]}`} }`;
    if (aliases.has(name)) return `type ${name}${parameters} = ${body};`;
    // Only the DOM's own bases: one from the language's lib (`Map<K, V>`) is not the stand-ins' to restate.
    const extended = [...(bases.get(name) ?? [])].filter((base) => types.has(base));
    return `interface ${name}${parameters}${extended.length === 0 ? "" : ` extends ${extended.join(", ")}`} ${body}`;
  });
  return [...declared, ...values.values()].join("\n");
}

/** How many type parameters the list opening at `open` holds — its top-level commas, plus one — and where it ends. */
function parameters(text: string, open: number): { count: number; end: number } {
  let depth = 0;
  let count = 1;
  for (let at = open; at < text.length; at++) {
    const char = text[at];
    if (char === "<" || char === "(" || char === "{" || char === "[") depth++;
    else if ((char === ">" && text[at - 1] !== "=") || char === ")" || char === "}" || char === "]") {
      depth--;
      if (depth === 0) return { count, end: at + 1 };
    } else if (char === "," && depth === 1) count++;
  }
  return { count, end: text.length };
}

/** `A, B<C, D>` → `A`, `B<C, D>`: a heritage list split at its top-level commas. */
function topLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < list.length; at++) {
    if (list[at] === "<") depth++;
    else if (list[at] === ">") depth--;
    else if (list[at] === "," && depth === 0) {
      parts.push(list.slice(from, at).trim());
      from = at + 1;
    }
  }
  parts.push(list.slice(from).trim());
  return parts;
}
