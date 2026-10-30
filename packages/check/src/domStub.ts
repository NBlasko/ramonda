import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

/**
 * The DOM's names, each as a stand-in, for a program that reads types — see `createProgram` in
 * `analyze.ts`.
 *
 * Why stand-ins: the rules that ask a TYPE (`form-value-in-the-wrong-control`, the form's reset in
 * `reset-the-model-does-not-hear`, a `type` read off its type) ask it through core's and the form's
 * declarations, which name `HTMLInputElement`, `Event` and the rest. The DOM lib that declares
 * them is 2.3 MB to parse for contents the answer never reads; its NAMES are all the answer needs —
 * but for a form's: `HTMLFormElement` and every interface it extends keep their members as the DOM lib
 * writes them, with every alias those name (`AutoFill`), so whether a form fits a type
 * (`reset-the-model-does-not-hear`) is TypeScript's answer.
 * Read from the DOM lib of the TypeScript this package runs, so they are always the names core's and
 * the form's declarations were written against — nothing here is kept by hand.
 *
 * Each interface and type is DISTINCT — an empty one is `{}`, everything is assignable to it, and the
 * form then took a whole schema for a `File` (measured): the answer collapsed to `any`. An interface
 * keeps the DOM interfaces it extends, so `HTMLInputElement` is still an `HTMLElement` where core's
 * types ask. A generic one keeps its arity, every parameter defaulted. A value keeps its type when
 * that is one of these names (`declare var document: Document`); a function takes anything.
 *
 * A constructor stays one — `declare var HTMLFormElement: { prototype: HTMLFormElement; new (…) }` — so
 * `node instanceof HTMLFormElement` narrows as it does with the DOM lib.
 */
export function domStub(): string {
  if (built === undefined) {
    built = standInsFor(readFileSync(join(dirname(ts.getDefaultLibFilePath({})), "lib.dom.d.ts"), "utf8"));
  }
  return built;
}

let built: string | undefined;

function standInsFor(lib: string): string {
  /** What each interface says, as written — one body for each time the DOM lib declares it. */
  const bodies = new Map<string, string[]>();
  /** Each alias as the DOM lib declares it, in one line: `type AutoFill = AutoFillBase | …;`. */
  const aliasDeclarations = new Map<string, string>();
  const types = new Map<string, number>();
  const aliases = new Set<string>();
  const bases = new Map<string, Set<string>>();
  for (const match of lib.matchAll(/^(?:declare )?(interface|type) (\w+)(<)?/gm)) {
    const [, kind, name, generic] = match;
    const after = match.index + match[0].length;
    const list = generic === undefined ? { count: 0, end: after } : parameters(lib, after - 1);
    if (!types.has(name)) types.set(name, list.count);
    if (kind === "type") {
      aliases.add(name);
      aliasDeclarations.set(name, lib.slice(match.index, lib.indexOf(";\n", match.index) + 1));
    }
    const extended = /^ extends ([^{]+) \{/.exec(lib.slice(list.end, lib.indexOf("\n", list.end)))?.[1];
    if (kind === "interface" && extended !== undefined) {
      const known = bases.get(name) ?? new Set<string>();
      // Without its arguments: they name the original's parameters, which the stand-in renames.
      for (const base of topLevel(extended)) known.add(base.replace(/<.*$/s, ""));
      bases.set(name, known);
    }
    if (kind === "interface") {
      // The body runs from its `{` to the `}` that closes it at the start of a line, as the DOM lib writes it.
      const open = lib.indexOf("{", list.end);
      bodies.set(name, [...(bodies.get(name) ?? []), lib.slice(open + 1, lib.indexOf("\n}", open))]);
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
        : type !== undefined && types.has(type)
          ? `declare var ${name}: ${type};`
          : types.has(name)
            ? `declare var ${name}: { prototype: ${name}; new (...args: any[]): ${name} };`
            : `declare var ${name}: any;`,
    );
  }
  // A form and every interface it extends keep what they say, so whether a form fits a type is
  // TypeScript's own answer — `{ reset(): void }` holds one, `{ reset?: boolean }` does not.
  const form = new Set<string>();
  const visit = (name: string): void => {
    if (form.has(name)) return;
    form.add(name);
    for (const base of bases.get(name) ?? []) visit(base);
  };
  visit("HTMLFormElement");
  // An interface that inherits members from two of them — `Window` from `EventTarget` and
  // `GlobalEventHandlers` — restates the ones they disagree on, `addEventListener`, as the DOM lib does,
  // so it keeps what it says too; else the two collide.
  const inherits = (name: string): boolean =>
    form.has(name) || [...(bases.get(name) ?? [])].some((base) => inherits(base));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, known] of bases) {
      if (!form.has(name) && [...known].filter(inherits).length > 1) {
        form.add(name);
        grew = true;
      }
    }
  }
  // An alias a kept body names keeps what it says too — `autocomplete: AutoFill` is a string to TypeScript,
  // as a type that names it as one expects — and so does every alias that one names in turn.
  const keptAliases = new Set<string>();
  const named = (text: string): void => {
    for (const [word] of text.matchAll(/\w+/g)) {
      const declaration = aliasDeclarations.get(word);
      if (declaration === undefined || keptAliases.has(word)) continue;
      keptAliases.add(word);
      named(declaration);
    }
  };
  for (const name of form) for (const body of bodies.get(name) ?? []) named(body);
  const declared = [...types].map(([name, count]) => {
    const kept = keptAliases.has(name) ? aliasDeclarations.get(name) : undefined;
    if (kept !== undefined) return kept;
    const parameters = count === 0 ? "" : `<${Array.from({ length: count }, (_, i) => `T${i} = any`).join(", ")}>`;
    const mark = `readonly "stub:${name}": never`;
    const body = form.has(name) ? `{ ${mark};${(bodies.get(name) ?? []).join("")}}` : `{ ${mark} }`;
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
