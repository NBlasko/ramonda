import { nameForSite } from "./names";
import { normalise } from "./normalise";
import { readBlock } from "./read";
import { findBlocks } from "./scan";

/**
 * Every named site in a file, as the binding it is assigned to and the CSS name it becomes.
 *
 * ## Why a reference is resolved at BUILD time
 *
 * `const slide = @@keyframes( … )` compiles to a string, and a block that refers to it does so
 * through a hole — `animation: {{slide}} 3s`. A hole is ordinarily a custom property set on an
 * element, which is exactly right for a value the runtime computes and wrong for this one in two
 * ways, one merely wasteful and one fatal:
 *
 * - the name was decided by this compiler three lines up, so an element carrying it as a variable is
 *   work done at run time for a constant;
 * - **`var()` takes a literal name.** `var({{angle}})` would become `var(var(--r-…-0))`, and
 *   measured in Chromium nothing resolves — the declaration is dropped and the style is silently
 *   absent. A registered property could be READ by nothing.
 *
 * So a hole whose expression is exactly one of these bindings is not a hole. It is that name, and
 * the read writes it straight into the text — which is also what lets one stand in a property NAME,
 * the position a hole may never occupy, and the only way a registered property can be SET.
 *
 * ## Why the name of a `@property` is different
 *
 * `@keyframes r-… { … }` is a valid rule and `@property r-… { … }` is not: what `@property`
 * registers is a CUSTOM PROPERTY, and a custom property is spelled `--` and then a name. So the two
 * dashes are part of what it is called, in the stylesheet and in the string the site compiles to,
 * and `var({{angle}})` is `var(--r-…)` because that is the only thing it could be.
 *
 * ## Order
 *
 * Built in source order, so a named site sees only the ones above it — which is what a `const` does
 * anyway, and what keeps a site that refers to another from being a question about itself.
 */
/** `@@` and then a name character, which only a named site has. See the note inside. */
const NAMED_OPENING = /@@[A-Za-z0-9_-]/;

/**
 * A named import of a relative module, at the start of a line.
 *
 * Line-anchored rather than parsed, because this runs beside every read of every file and a TS
 * program per file is not a cost it can carry. An `import` declaration is a statement, so it starts
 * a line in every formatter anybody uses — and the failure mode of a false positive is a module that
 * does not exist, which resolves to nothing. Reading is the only thing at stake and it fails closed.
 *
 * `from "./x"` only: a package specifier needs a resolver, and the four consumers of this function
 * would each have to bring the same one — see the note on {@link Imported}.
 *
 * A DEFAULT import before the clause is allowed, and used not to be: `import d, { accent } from
 * "./theme"` resolved nothing at all, so the token silently degraded to a hole. Loud, through
 * `hole-as-a-variable-name` — but it is a shape none of the three documented limits mentions, and
 * nothing about a default import makes the named ones unreadable.
 */
const AN_IMPORT = /^[ \t]*import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s+from\s+["'](\.[^"']*)["']/gm;

/**
 * The source with every block comment blanked out, so a commented-out import is not read as one.
 *
 * The line anchor above already rejects `// import … `; a `/* … *\/` opened at column 0 it did not,
 * and the note above claims the failure mode "fails closed". Measured, it fails OPEN when the module
 * exists: an import inside a block comment still resolved its token, and the build that should have
 * refused compiled — **commenting an import out to see whether it is needed is the ordinary way to
 * find out**, and here it changed nothing except that an error disappeared.
 *
 * Blanked rather than removed, so every offset after it is unmoved and the line anchor still sees
 * the lines it saw.
 *
 * A scan, not a parse: a `/*` written inside a string swallows the rest of the file, so an import
 * below it goes unread. That is the direction this is allowed to be wrong in — an unresolved
 * reference stays a hole and `hole-as-a-variable-name` reports it, which is the closed failure the
 * note claimed and did not have.
 */
function outsideComments(source: string): string {
  if (!source.includes("/*")) return source;

  let out = "";
  let at = 0;
  for (;;) {
    const open = source.indexOf("/*", at);
    if (open === -1) return out + source.slice(at);
    const close = source.indexOf("*/", open + 2);
    const end = close === -1 ? source.length : close + 2;
    out += source.slice(at, open) + source.slice(open, end).replace(/[^\n]/g, " ");
    at = end;
  }
}

export interface Imported {
  /** For resolving a relative specifier. The importing file's own path. */
  readonly filename?: string;
  /**
   * The text of a module a specifier resolves to, or `undefined` for one that cannot be read.
   *
   * **Injected rather than `fs`, and that is the whole reason this is a parameter.** A build reads
   * the disk; the editor must read its own buffer, which holds what the author has typed and not
   * yet saved. Two consumers reading two different texts of one module would see two different
   * DECLARATIONS in it — and the editor would then report a fault the build does not have, or miss
   * one it does.
   *
   * The name itself is a hash of the parsed BLOCK, not of the text, which is more robust than this
   * note used to claim: measured, LF against CRLF, a leading BOM and any amount of code around the
   * declaration all give the same name. What a differing text changes is what the declaration SAYS,
   * which is enough.
   */
  readonly read?: (specifier: string, from: string) => string | undefined;
}

/**
 * The sites another module declares, under the names this file imports them by.
 *
 * ONE HOP, deliberately: a site in the imported file that itself reads a third file is not resolved
 * here, and that third file's own compile is where it is reported. Following the chain makes this a
 * module graph, and a module graph inside a per-file transform is a cycle waiting to be found by
 * somebody's build rather than by a test.
 */
function imported(source: string, options: Imported, texts?: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const read = options.read;
  if (read === undefined) return out;

  for (const found of outsideComments(source).matchAll(AN_IMPORT)) {
    const [, clause, specifier] = found;
    // Read once per specifier, and only when the clause names something.
    const names = clause
      .split(",")
      .map((one) => one.trim())
      .filter((one) => one !== "");
    if (names.length === 0) continue;

    const text = read(specifier, options.filename ?? "");
    if (text === undefined || !NAMED_OPENING.test(text)) continue;

    // No `read` passed on: the hop stops here, so the imported file's own imports stay unresolved.
    const theirs = namedSites(text);
    let used = false;
    for (const one of names) {
      const [exported, local] = one.split(/\s+as\s+/);
      const name = theirs.get(exported.trim());
      if (name !== undefined) {
        out.set((local ?? exported).trim(), name);
        used = true;
      }
    }
    if (used) texts?.push(text);
  }

  return out;
}

/**
 * The sites another module declares, AND the text of every module that contributed one.
 *
 * **The texts are not a convenience, they are the fix for a trap the design walked into.** A
 * reference resolves to TEXT, so after the transform the imported binding is not referenced by the
 * emitted code at all — the import goes unused, the bundler drops the module, and the `@property`
 * rule it declared never reaches the stylesheet. Measured in a real Vite build: the reading classes
 * were right and the registration was simply absent.
 *
 * So the file that READS a token emits that token's rule itself. It costs nothing to do twice: the
 * name is a hash of the declaration itself, so every file that reads the same token emits the same
 * rule under the same name, and the sheet keeps one. The theme module need not be in the JavaScript
 * graph at all.
 */
export function importedSites(source: string, options: Imported): { names: Map<string, string>; texts: string[] } {
  const texts: string[] = [];
  const names = source.includes("import") ? imported(source, options, texts) : new Map<string, string>();
  return { names, texts };
}

/**
 * Every registered property's generated NAME, and the `syntax` its site declared.
 *
 * The other half of {@link namedSites}: that answers "what is this reference called", this answers
 * "what may it hold". Both are needed to see a registered property set to a value it refuses —
 * measured in Chromium, `--angle: 12px` on a `<angle>` property computes to the `initial-value` and
 * says nothing, so the element shows the default and looks deliberate.
 *
 * Local sites only. A token from another module is declared where its own file is compiled, and
 * that file is where a value it refuses would be written — so following the import buys nothing
 * here and would make this a second place that resolves modules.
 */
export function syntaxesIn(source: string, options: Imported = {}): Map<string, string> {
  const out = new Map<string, string>();
  if (!NAMED_OPENING.test(source)) return out;

  /**
   * The SAME resolution `namedSites` uses, because the name is the same name.
   *
   * It read with no `resolve` at all, so a `@@property` whose own body names another token — the
   * ordinary shape of a theme — normalised to different text here and hashed to a different name.
   * Measured, the two maps disagreed:
   *
   *     namedSites   [["base","--r-k8u6ISIlk"],["other","--r-Uo2yQGE1g"]]
   *     syntaxesIn   [["--r-k8u6ISIlk","<color>"],["--r-7DeqAp7g7","<color>"]]
   *
   * `--r-Uo2yQGE1g` appears in no syntax map, so the transform never checked what `other` may hold —
   * and `{other}: 12px` on a `<color>` property COMPILED, which is the exact failure
   * `value-and-registered-syntax` exists to prevent. `{base}: 12px` was refused on the same run.
   */
  const references = namedSites(source, options);

  for (const site of findBlocks(source)) {
    if (site.at !== "property") continue;
    const read = readBlock(source, site.open, "", { tolerant: true, resolve: (name) => references.get(name) });

    for (const item of read.block.items) {
      if (item.kind !== "declaration" || item.property !== "syntax") continue;
      // A syntax written with a hole cannot be read, and neither can one this loop did not reach.
      if (!item.value.every((part) => part.kind === "text")) continue;
      const text = item.value
        .map((part) => (part.kind === "text" ? part.text : ""))
        .join("")
        .trim()
        .replace(/^["']|["']$/g, "");
      out.set(nameForSite("property", site.name, normalise(read.block)), text);
    }
  }

  return out;
}

export function namedSites(source: string, options: Imported = {}): Map<string, string> {
  // What another module declares, first — so a site declared HERE overwrites it, which is what a
  // local binding does to an imported one in TypeScript.
  const found = source.includes("import") ? imported(source, options) : new Map<string, string>();
  // The same bargain as `mayHoldABlock`, and for the same reason: this runs beside every read of
  // every file, and a NAMED site needs a name character after the two `@`. Measured on a 40-block
  // file with none, the full walk was 0.029 ms against the virtual file's 0.35 — real, and avoidable
  // without asking the expensive question. An ordinary block reaches `@@(` and stops here.
  //
  // What was imported is kept: a file may declare no site of its own and still read one.
  if (!NAMED_OPENING.test(source)) return found;

  for (const site of findBlocks(source)) {
    if (site.at === undefined || site.name === "") continue;

    // Tolerant: this runs in an editor as well as in a build, and a name is still a name while the
    // block under it is half-typed. What is wrong with the block is reported by whoever reads it
    // properly — saying it twice, from here, would say it about the wrong thing.
    const read = readBlock(source, site.open, "", { tolerant: true, resolve: (name) => found.get(name) });
    found.set(site.name, nameForSite(site.at, site.name, normalise(read.block)));
  }

  return found;
}
