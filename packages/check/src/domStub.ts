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
 * A constructor stays one — `declare var HTMLFormElement: { prototype: HTMLFormElement; new (…) }` — so
 * `node instanceof HTMLFormElement` narrows as it does with the DOM lib.
 */
export function domStub(): string {
  return read().stub;
}

/**
 * The names of every member a form has — `HTMLFormElement`'s own and every DOM interface it extends,
 * and the stand-ins' marks of each — read from the same DOM lib. The stand-ins keep no members, so
 * whether a form FITS a type is asked by these names: a type whose every required member a form
 * has can hold one (`const r: { reset(): void; submit(): void } = form`). See
 * `reset-the-model-does-not-hear`.
 */
export function formMembers(): ReadonlySet<string> {
  return read().formMembers;
}

/**
 * Which of `formMembers` a form holds a function in — its methods, `reset` and `submit`, and its event
 * handlers — which a type a form fits holds one in too, and no other.
 */
export function formMethods(): ReadonlySet<string> {
  return read().formMethods;
}

type Read = { stub: string; formMembers: ReadonlySet<string>; formMethods: ReadonlySet<string> };

let built: Read | undefined;

function read(): Read {
  if (built === undefined) {
    built = standInsFor(readFileSync(join(dirname(ts.getDefaultLibFilePath({})), "lib.dom.d.ts"), "utf8"));
  }
  return built;
}

function standInsFor(lib: string): Read {
  const members = new Map<string, Set<string>>();
  /** Each member's type as written, `undefined` for a method — read once every function type is known. */
  const typed = new Map<string, Map<string, string | undefined>>();
  /** What each alias and each callable interface says, for which types are functions. */
  const aliasBodies = new Map<string, string>();
  const callableInterfaces = new Set<string>();
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
      aliasBodies.set(name, lib.slice(list.end, lib.indexOf(";\n", list.end)));
    }
    const extended = /^ extends ([^{]+) \{/.exec(lib.slice(list.end, lib.indexOf("\n", list.end)))?.[1];
    if (kind === "interface" && extended !== undefined) {
      const known = bases.get(name) ?? new Set<string>();
      // Without its arguments: they name the original's parameters, which the stand-in renames.
      for (const base of topLevel(extended)) known.add(base.replace(/<.*$/s, ""));
      bases.set(name, known);
    }
    if (kind === "interface") {
      // The body runs to the `}` that closes it at the start of a line, as the DOM lib writes it.
      const body = lib.slice(list.end, lib.indexOf("\n}", list.end));
      if (/^ {4}\(/m.test(body)) callableInterfaces.add(name);
      const own = members.get(name) ?? new Set<string>();
      const types_ = typed.get(name) ?? new Map<string, string | undefined>();
      for (const member of body.matchAll(/^ {4}(readonly |get |set )?(\w+)\??([(:<])(.*)$/gm)) {
        own.add(member[2]);
        // A method — `name(` or `name<T>(`, no `get`/`set` before it — has no type to read: it is one.
        types_.set(member[2], member[1] === undefined && member[3] !== ":" ? undefined : member[4]);
      }
      members.set(name, own);
      typed.set(name, types_);
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
  const declared = [...types].map(([name, count]) => {
    const parameters = count === 0 ? "" : `<${Array.from({ length: count }, (_, i) => `T${i} = any`).join(", ")}>`;
    const body = `{ readonly "stub:${name}": never }`;
    if (aliases.has(name)) return `type ${name}${parameters} = ${body};`;
    // Only the DOM's own bases: one from the language's lib (`Map<K, V>`) is not the stand-ins' to restate.
    const extended = [...(bases.get(name) ?? [])].filter((base) => types.has(base));
    return `interface ${name}${parameters}${extended.length === 0 ? "" : ` extends ${extended.join(", ")}`} ${body}`;
  });
  // The types that are functions: an alias to an arrow, an interface with a call signature, and an alias
  // to either — `OnErrorEventHandler` is `OnErrorEventHandlerNonNull | null`, a callable interface.
  const functionTypes = new Set(callableInterfaces);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [alias, body] of aliasBodies) {
      if (functionTypes.has(alias)) continue;
      if (body.includes("=>") || (body.match(/\w+/g) ?? []).some((word) => functionTypes.has(word))) {
        functionTypes.add(alias);
        grew = true;
      }
    }
  }
  // A function the form holds: a method, or a member whose type is one, as an event handler's is
  // (`onclick: ((…) => any) | null`, `onerror: OnErrorEventHandler`).
  const isAFunction = (type: string | undefined) =>
    type === undefined || type.includes("=>") || (type.match(/\w+/g) ?? []).some((word) => functionTypes.has(word));
  const methods = new Map<string, Set<string>>();
  for (const [name, members_] of typed) {
    methods.set(name, new Set([...members_].filter(([, type]) => isAFunction(type)).map(([member]) => member)));
  }
  const formMembers = new Set<string>();
  const formMethods = new Set<string>();
  const visit = (name: string): void => {
    if (formMembers.has(`stub:${name}`)) return;
    formMembers.add(`stub:${name}`);
    for (const member of members.get(name) ?? []) formMembers.add(member);
    for (const member of methods.get(name) ?? []) formMethods.add(member);
    for (const base of bases.get(name) ?? []) visit(base);
  };
  visit("HTMLFormElement");
  return { stub: [...declared, ...values.values()].join("\n"), formMembers, formMethods };
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
