/**
 * What an editor actually OFFERS, for a flat string union against a nested object.
 *
 *     node packages/css/prototype-token-completion.mjs
 *
 * ## The question
 *
 * `DESIGN.md` weighs a `$.color.primary.main` spelling for tokens against generating the same names
 * into the VALUE type as `var(--${Token})`. I claimed the union "recovers most of what the nested
 * spelling is attractive for", because an editor filters a string completion by prefix.
 *
 * The user's objection is that filtering and grouping are not the same thing: `$.` then `color.`
 * then `primary.` shows one level at a time, where a union shows every token at once however it is
 * typed. That is a claim about what the language service RETURNS, so it is asked — this uses
 * `getCompletionsAtPosition`, the same call an editor makes, rather than a screenshot or a memory.
 *
 * What it cannot see: VS Code narrows the DISPLAYED list client-side by what has been typed. So the
 * count here is what the service hands over, and the argument rests on something the count shows
 * either way — filtering needs the name already, and a level tells you what exists.
 */
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("typescript");

/** A token scale the shape of a real one: 6 groups, a few levels, 204 leaves. */
const GROUPS = {
  color: {
    primary: ["main", "light", "dark", "contrast"],
    surface: ["base", "raised", "sunken"],
    text: ["primary", "secondary", "disabled", "inverse"],
    border: ["subtle", "strong", "focus"],
    state: ["hover", "active", "selected", "error", "warning", "success"],
  },
  space: {
    inline: ["xs", "sm", "md", "lg", "xl", "2xl"],
    block: ["xs", "sm", "md", "lg", "xl", "2xl"],
    gutter: ["narrow", "default", "wide"],
  },
  size: {
    icon: ["xs", "sm", "md", "lg"],
    control: ["sm", "md", "lg"],
    container: ["sm", "md", "lg", "xl", "full"],
    radius: ["none", "sm", "md", "lg", "pill", "circle"],
  },
  font: {
    family: ["sans", "serif", "mono"],
    size: ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"],
    weight: ["light", "regular", "medium", "bold"],
    leading: ["tight", "normal", "loose"],
    tracking: ["tight", "normal", "wide"],
  },
  shadow: { elevation: ["0", "1", "2", "3", "4"], focus: ["ring", "ring-error"] },
  motion: { duration: ["instant", "fast", "normal", "slow"], easing: ["linear", "standard", "enter", "exit"] },
};

const leaves = [];
for (const [a, mid] of Object.entries(GROUPS))
  for (const [b, ends] of Object.entries(mid)) for (const c of ends) leaves.push(`${a}-${b}-${c}`);

const union = leaves.map((one) => JSON.stringify(`var(--${one})`)).join(" | ");

const nested = (obj, indent = "  ") =>
  Object.entries(obj)
    .map(([k, v]) =>
      Array.isArray(v)
        ? `${indent}${JSON.stringify(k)}: { ${v.map((c) => `${JSON.stringify(c)}: string`).join("; ")} };`
        : `${indent}${JSON.stringify(k)}: {\n${nested(v, indent + "  ")}\n${indent}};`,
    )
    .join("\n");

/** `@@@` marks where the cursor is; it is cut out before the file is handed over. */
const CASES = {
  "a value typed `Token` (the flat union), cursor inside the empty string": `
type Token = ${union};
declare function set(v: Token): void;
set("@@@");
`,
  "the same union, after `var(--color-`": `
type Token = ${union};
declare function set(v: Token): void;
set("var(--color-@@@");
`,
  "`$.` — the nested object, first level": `
declare const $: {
${nested(GROUPS)}
};
declare function set(v: string): void;
set($.@@@);
`,
  "`$.color.` — second level": `
declare const $: {
${nested(GROUPS)}
};
declare function set(v: string): void;
set($.color.@@@);
`,
  "`$.color.primary.` — third level": `
declare const $: {
${nested(GROUPS)}
};
declare function set(v: string): void;
set($.color.primary.@@@);
`,
};

console.log(`  ${leaves.length} tokens, in ${Object.keys(GROUPS).length} groups\n`);
console.log(`  ${"where the cursor is".padEnd(52)}  offered  the first few`);
console.log(`  ${"-".repeat(52)}  -------  -------------`);

for (const [label, source] of Object.entries(CASES)) {
  const at = source.indexOf("@@@");
  const text = source.replace("@@@", "");
  const host = {
    getScriptFileNames: () => ["f.ts"],
    getScriptVersion: () => "1",
    getScriptSnapshot: (n) => (n === "f.ts" ? ts.ScriptSnapshot.fromString(text) : undefined),
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => ({ strict: true, target: ts.ScriptTarget.ES2022, types: [] }),
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  const got = service.getCompletionsAtPosition("f.ts", at, {});
  const names = (got?.entries ?? []).map((e) => e.name);
  const shown = names
    .slice(0, 3)
    .map((n) => (n.length > 24 ? `${n.slice(0, 23)}…` : n))
    .join(", ");
  console.log(`  ${label.padEnd(52)}  ${String(names.length).padStart(7)}  ${shown}${names.length > 3 ? ", …" : ""}`);
}
