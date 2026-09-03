/**
 * Checks that no example anywhere writes a host element's event handler in the spelling the
 * framework refuses.
 *
 * ## The fault it exists for
 *
 * An event handler in this framework's JSX is `on` plus the event's own name, LOWERCASE —
 * `onclick`, `oninput`, `onmouseenter` — because every event type in the DOM's element maps is a
 * single lowercase token, so the name can be derived rather than tabulated. The capitalised form is
 * refused by the types, and the refusal names the spelling to use.
 *
 * The prose did not follow. Nine docstrings across four packages described the fault they report or
 * the API they document with a capital, and two of those strings are not comments at all: one is a
 * rule's `advice`, printed in the terminal and generated onto a documentation page, and one is the
 * sentence a report prints beside an `<a>` with no `href`. A reader who copies either gets a compile
 * error from the framework that had just told them what to write.
 *
 * Nothing could catch it. A comment is not typechecked, an `advice` string is not code, and the one
 * gate that would have refused the spelling — the docs' own typecheck — skips a one-line example.
 *
 * ## What it checks, in two shapes, because prose writes the name both ways
 *
 * **Written on a tag** — `<div onClick={…}>`. Any capital is refused, and the TAG's case is what
 * makes that answerable: a host element is lowercase and its attributes are the DOM's, while a
 * component is capitalised and an `onSelect` on it is a prop somebody declared, which keeps its
 * camelCase and is none of this script's business.
 *
 * **Written alone** — `` `onClick={this.submit}` `` in a sentence, with no tag to read the case of.
 * This is the shape that mattered: one of them is the FIX text of a live diagnostic, printed to
 * every developer who trips RMD020. With no tag, the name itself has to answer, so it is refused
 * when its lowercase form is an event the DOM actually has.
 *
 * That list is READ, not kept — the event maps in TypeScript's own `lib.dom.d.ts`, which is the
 * same declaration the framework's handler types are mapped over. A name the DOM does not have is
 * not a handler at all: `onLoading={<p>…</p>}` is a component's prop and passes, which is the
 * distinction a hand-written list would have got wrong the first time somebody added an event.
 *
 * `on:my-event` is untouched in both shapes: the part after a colon is handed through verbatim, and
 * a custom event may be spelled however it was dispatched.
 *
 * ## What is allowed, and why the source says so rather than this script
 *
 * Three kinds of line write the refused spelling on purpose, and every one of them is already
 * marked where it is written — so this reads the mark instead of keeping a list of files, which
 * would go stale the first time one was renamed.
 *
 * - **A claim that the spelling is refused.** `@ts-expect-error` on the comment above the element
 *   IS that claim: the line is asserted not to compile, which is the opposite of the fault.
 * - **A fixture feeding an analyzer the old spelling**, because a project with no types still
 *   compiles it and the rule has to see it. Marked `refused-spelling-on-purpose`.
 * - **A changelog**, which records what a version did and was accurate when written. Rewriting one
 *   would make it a worse record without making anything compile.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);
const root = resolve(dirname(self), "..");

/** Where prose and examples live. Build output and dependencies have nothing to fix. */
const SKIP = new Set(["node_modules", "dist", ".turbo", ".git", "coverage", "generated"]);

function* filesUnder(directory) {
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* filesUnder(path);
    // Not a list of exempt files, which would go stale: the one file skipped is THIS one, which
    // has to quote the fault to explain it, and knows itself by name rather than by a table.
    else if (/\.(ts|tsx|mjs|md)$/.test(entry) && basename(path) !== "CHANGELOG.md" && path !== self) yield path;
  }
}

/**
 * A handler written inside ONE opening tag whose name is lowercase.
 *
 * `[^<>]` spans newlines, so an attribute on its own line is still found; it cannot leave the tag,
 * because the next `<` or `>` ends the match.
 *
 * ## The one shape it misses, and why making it quote-aware was rejected
 *
 * A `>` inside a quoted attribute value ends the match early, so `<div title="a>b" onClick={…}>`
 * is not seen. Teaching the pattern about quotes is one alternation and it is CORRECT: measured, it
 * catches that case, still refuses a component tag, and does not leak onto the next element.
 *
 * It is also exponential. The alternation gives the engine two ways to consume every quoted
 * attribute, and a lazy quantifier makes it try all of them before failing:
 *
 * ```
 *   quoted attributes on one tag    8     12      16       20         24
 *   time to fail                  0.2ms  1.3ms  50.3ms  2,306ms  108,313ms
 * ```
 *
 * Twenty-four attributes on one element is an ordinary form control, and it would hang the build
 * for two minutes. **A gate that can stop a build is worse than one that misses a rare shape**, so
 * the shape stays missed and this note stays here — the fix looks obviously right, and it is the
 * measurement that says otherwise.
 */
const WRITTEN = /<([a-z][a-z0-9-]*)\b[^<>]*?\b(on[A-Z][A-Za-z]*)\s*=/g;

/**
 * The same name written INSIDE BACKTICKS, with no tag around it — how prose quotes a handler.
 *
 * The backticks are what make it a sentence about code rather than code. Without them the shape
 * has too many other meanings to judge: `const onChange = {…}` is a variable, `onSubmit={…}` in a
 * test's options object is a field name, and a gate that reported thirty of those would be turned
 * off before it caught the one that matters.
 */
const ALONE = /`(on[A-Z][A-Za-z]*)=[^`]*`/g;

/**
 * Every event name the DOM declares, from the maps the framework's own handler types are built over.
 *
 * Read rather than listed. `EventHandlers` in `core/types/commonTypes.ts` maps `` `on${K}` `` over
 * `HTMLElementEventMap & HTMLMediaElementEventMap`, and the first of those inherits the other two
 * read here — so this is the same set of names, arrived at from the same declaration file, and it
 * cannot drift from what the types accept.
 */
function domEventNames() {
  const lib = join(root, "node_modules/typescript/lib/lib.dom.d.ts");
  const source = readFileSync(lib, "utf8");
  const names = new Set();
  for (const map of [
    "HTMLElementEventMap",
    "HTMLMediaElementEventMap",
    "GlobalEventHandlersEventMap",
    "ElementEventMap",
  ]) {
    const body = source.match(new RegExp(`interface ${map}[^{]*\\{([^}]*)\\}`));
    if (body === null) throw new Error(`lib.dom.d.ts has no ${map} — the derivation this rests on has moved.`);
    for (const key of body[1].matchAll(/"([a-z0-9]+)"\s*:/g)) names.add(key[1]);
  }
  return names;
}

const EVENTS = domEventNames();

/**
 * The comment written immediately above an element, or `""` where there is none.
 *
 * Immediately, rather than "within a few lines": a mark excuses the element it was written for, and
 * a distance that is a guess would start excusing the next one along.
 */
function commentAbove(source, index) {
  // `{`/`}` because a JSX comment is `{/* … */}` and the braces are the wrapper, not the mark.
  const before = source.slice(0, index).replace(/[\s{}]+$/, "");
  if (before.endsWith("*/")) {
    const opened = before.lastIndexOf("/*");
    return opened === -1 ? "" : before.slice(opened);
  }
  const line = before.slice(before.lastIndexOf("\n") + 1).trim();
  return line.startsWith("//") || line.startsWith("*") ? line : "";
}

/** A mark on the comment above says the spelling is deliberate. See the header for the three kinds. */
function excused(source, index) {
  const mark = commentAbove(source, index);
  return mark.includes("@ts-expect-error") || mark.includes("refused-spelling-on-purpose");
}

function at(source, index) {
  return { line: source.slice(0, index).split("\n").length };
}

const found = [];
for (const directory of ["packages", "apps", "scripts"]) {
  for (const file of filesUnder(join(root, directory))) {
    const source = readFileSync(file, "utf8");
    const seen = new Set();
    for (const match of source.matchAll(WRITTEN)) {
      const tagAt = source.lastIndexOf("<", match.index + 1);
      if (excused(source, tagAt)) continue;
      seen.add(match.index + match[0].lastIndexOf(match[2]));
      found.push({ ...at(source, match.index), file: relative(root, file), tag: match[1], name: match[2] });
    }
    for (const match of source.matchAll(ALONE)) {
      // The tagged pass has already judged this one, with the better evidence of the two.
      if (seen.has(match.index)) continue;
      if (!EVENTS.has(match[1].slice(2).toLowerCase())) continue;
      if (excused(source, match.index)) continue;
      found.push({ ...at(source, match.index), file: relative(root, file), tag: undefined, name: match[1] });
    }
  }
}

if (found.length > 0) {
  console.error(`${found.length} handler(s) spelled in a form the framework refuses:\n`);
  for (const one of found) {
    console.error(`  ${one.file}:${one.line}`);
    const written = one.tag === undefined ? `${one.name}={…}` : `<${one.tag} ${one.name}={…}>`;
    console.error(`    ${written} — write \`${one.name.toLowerCase()}\`.`);
  }
  console.error(
    "\nA host element's handler is `on` plus the DOM's own event name, lowercase. The types refuse\n" +
      "the capital, so an example carrying one does not compile for the reader who copies it.\n" +
      "Written on purpose? Mark the comment above it `refused-spelling-on-purpose`, with the reason.\n",
  );
  process.exit(1);
}

console.log("Event handler spellings: every host element uses the DOM's own name.");
