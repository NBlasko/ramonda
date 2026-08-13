#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { analyzeProject } from "./analyze";

/**
 * `ramonda-check [tsconfig]`
 *
 * Reads your source and reports three things a running page would not tell you:
 *
 * - a context consumer with no provider above it on some path the source can produce — the page
 *   renders, the context quietly falls back to its default, and the numbers are wrong;
 * - a class field holding a function literal, which in Ramonda is a closure per instance for
 *   nothing, since every method is already bound;
 * - a single-use decorator declared twice, which the runtime can only report once the class is
 *   reached — a class behind a condition nobody clicked ships with the fault;
 * - a component that READS a form field it was handed without watching it, which never re-renders and
 *   which nothing at runtime can report, because the form cannot see who is rendering.
 *
 * Meant to sit in an app's `build` script: a check nobody runs is a check that does not exist.
 *
 * `--graph <file>` also writes the composition graph the checks are computed from — which
 * components exist and which one can mount which, including the edges nothing could resolve.
 */
const argv = process.argv.slice(2);
const graphAt = argv.includes("--graph") ? argv[argv.indexOf("--graph") + 1] : undefined;
const arg = argv.find((a) => !a.startsWith("--") && a !== graphAt);
const tsconfig = resolve(arg ?? "tsconfig.json");
const TAG = "[ramonda-check]";

if (!existsSync(tsconfig)) {
  console.error(`${TAG} no tsconfig at ${tsconfig}. Pass one: ramonda-check <path>`);
  process.exit(2);
}
if (argv.includes("--graph") && !graphAt) {
  console.error(`${TAG} --graph wants a file to write: ramonda-check <tsconfig> --graph graph.json`);
  process.exit(2);
}

const {
  issues,
  arrowFields,
  duplicateDecorators,
  unwatchedFields,
  unresolved,
  annotated,
  unreachable,
  counts,
  graph,
  notes,
} = analyzeProject(tsconfig);

for (const note of notes) console.warn(`${TAG} ${note}`);

if (graphAt) {
  const target = resolve(graphAt);
  mkdirSync(dirname(target), { recursive: true });
  // Two spaces and a trailing newline: this is a file people will read in a review, and a diff
  // between two commits is the reason it exists at all.
  writeFileSync(target, `${JSON.stringify(graph, null, 2)}\n`);
  const holes = graph.edges.filter((e) => e.kind === "unresolved").length;
  console.log(
    `${TAG} graph written to ${graphAt} — ${graph.nodes.length} nodes, ${graph.edges.length} edges` +
      (holes > 0 ? `, ${holes} of them unresolved` : ""),
  );
}

/**
 * Every annotated site, on every run.
 *
 * The escape hatch is a RECORD, not a silence: printed whether or not anything failed, so the
 * number cannot creep up unread. This is also the only place a reader learns what the map does not
 * cover.
 */
if (annotated.length > 0) {
  console.warn(`\n${TAG} ${annotated.length} site(s) this cannot resolve, with a reason written beside them:\n`);
  for (const site of annotated) {
    console.warn(`  ${site.file}:${site.line}:${site.column}`);
    console.warn(`    ${site.what} — ${site.reason}`);
  }
  console.warn("");
}

if (
  issues.length === 0 &&
  arrowFields.length === 0 &&
  duplicateDecorators.length === 0 &&
  unwatchedFields.length === 0 &&
  unresolved.length === 0 &&
  unreachable.length === 0
) {
  console.log(
    `${TAG} ${counts.components} components, ${counts.contexts} contexts, ${counts.roots} root(s) — ` +
      `every consumer has a provider above it, no class field holds a function literal, no ` +
      `single-use decorator is declared twice, and every component reading a form field watches it.`,
  );
  process.exit(0);
}

/**
 * The strict rule: a component this cannot follow is an ERROR.
 *
 * The walk goes quiet below a name it cannot resolve, so everything under it is unjudged and the
 * build passes over a page that may be broken. A map with unmarked blanks is worse than no map,
 * because it is trusted. Whatever this cannot resolve, a bundler could not have code-split either.
 */
if (unresolved.length > 0) {
  console.error(`\n${TAG} ${unresolved.length} place(s) naming a component that cannot be followed:\n`);
  for (const hole of unresolved) {
    console.error(`  ${hole.file}:${hole.line}:${hole.column}`);
    console.error(`    through \`${hole.what}\` — ${hole.why}`);
    console.error("");
    for (const line of hole.fix.split("\n")) console.error(`      ${line}`);
    console.error("");
  }
  console.error(
    `Nothing below one of these is judged, so a broken page can pass. If the source is right and\n` +
      `this is the one that cannot see it, write the reason on the line — it is listed on every run:\n\n` +
      `    // ramonda-check-ignore the chunk is deliberately missing, to demonstrate the failure\n`,
  );
}

/**
 * The first rule computed from the graph rather than from the source.
 *
 * The walk visits everything a root mounts, so what it never arrived at is what nothing mounts. An
 * EXPORTED one is left alone: an app is entered through what it publishes, and an SSR entry is
 * called by the server rather than by this program.
 */
if (unreachable.length > 0) {
  console.error(`\n${TAG} ${unreachable.length} declaration(s) no root reaches:\n`);
  for (const dead of unreachable) {
    console.error(`  ${dead.file}:${dead.line}:${dead.column}`);
    console.error(`    ${dead.name} — nothing mounts this ${dead.kind}, on any path from any root.`);
    console.error("");
  }
  console.error(
    `Delete it, or mount it. Nothing outside its own file can even name it, so no import\n` +
      `elsewhere is keeping it alive — and an EXPORTED one is never reported, because an app is\n` +
      `entered through what it publishes and this cannot see who does the entering.\n`,
  );
}

if (issues.length > 0) {
  console.error(`\n${TAG} ${issues.length} consumer(s) with no provider above them:\n`);
  for (const issue of issues) {
    console.error(`  ${issue.file}:${issue.line}:${issue.column}`);
    console.error(`    <${issue.consumer}> consumes "${issue.context}" — nothing provides it on this path:`);
    console.error(`    ${issue.path.join(" → ")}`);
    console.error("");
  }
  console.error(
    `Mount the matching Provider on a component above it — a context reaches only the providing\n` +
      `component and its descendants. This ran before the app did, so nothing had to render for it\n` +
      `to be found.\n`,
  );
}

if (arrowFields.length > 0) {
  console.error(`\n${TAG} ${arrowFields.length} class field(s) holding a function literal:\n`);
  for (const field of arrowFields) {
    console.error(`  ${field.file}:${field.line}:${field.column}`);
    console.error(
      `    ${field.component}.${field.field} — ` +
        (field.readsThis
          ? "write it as a method. Ramonda binds every method to its instance, so it keeps `this`\n" +
            "    when it is passed to an element, and one function is shared by every instance."
          : "it does not read `this`, so move it out of the class — a module constant is built once\n" +
            "    rather than once per instance."),
    );
    console.error("");
  }
  console.error(
    `A field initialised from a CALL is a different thing and is not reported: ` +
      `\`debounce(this.save, 200)\`\nhas nowhere else to live. This is about a function written in ` +
      `the field itself.\n`,
  );
}

if (duplicateDecorators.length > 0) {
  console.error(`\n${TAG} ${duplicateDecorators.length} class(es) declaring a single-use decorator twice:\n`);
  for (const duplicate of duplicateDecorators) {
    /**
     * Which declaration is in effect, said per decorator KIND, because the two are opposite.
     *
     * The rule is the same for both — the last one APPLIED stands — but a member decorator
     * initialises top-to-bottom while a class decorator applies bottom-up, so "last applied" is the
     * lowest declaration in one case and the highest in the other. Measured in core's
     * `CatchErrorDecorator.test.tsx` and `PropsGateInheritance.test.tsx`. Naming the wrong one is
     * worse than naming neither: it points at the line that works.
     */
    const inEffect =
      duplicate.kind === "member"
        ? "the LOWEST is the one that runs (members initialise top to bottom, so it is applied last)"
        : "the HIGHEST is the one that runs (class decorators apply bottom-up, so it is applied last)";

    /**
     * One sentence per EFFECT, because "one of them never runs" is true of `@catchError` and false of
     * the other three.
     *
     * `@Host` throws, so there is no live line to find. `@StableProps` merges, so nothing was lost.
     * A doubled `@state` behaves exactly like a single one — measured, one render per write and the
     * right value. Sending a reader after a difference that is not there is worse than saying less.
     * One report, four faults, four pieces of advice.
     */
    const said =
      duplicate.effect === "refuses"
        ? `it THROWS — the class never loads, so there is no live declaration to look for.\n    ` +
          `Two answers to what it asks have no union. Keep the one you meant.`
        : duplicate.effect === "displaces"
          ? `there is one answer to what it asks, so ${inEffect}\n    and the rest never run. Keep one and combine what they do.`
          : duplicate.effect === "merges"
            ? `they MERGE — both take effect and the result is the union, so nothing is lost.\n    ` +
              `Write them as one call.`
            : `applying it twice changes nothing. The behaviour is identical to one, so this is a\n    ` +
              `mistaken belief rather than a broken program. Delete the extras.`;

    // The member is named for a `redundant` report, because that count is per member: without it,
    // "declares @state 2 times" reads like a claim about the class, which is a different fault.
    const where =
      duplicate.member === undefined
        ? `<${duplicate.component}>`
        : `${duplicate.component}.${duplicate.member} carries`;

    console.error(`  ${duplicate.file}:${duplicate.line}:${duplicate.column}`);
    console.error(
      `    ${where}${duplicate.member === undefined ? " declares" : ""} @${duplicate.decorator} ` +
        `${duplicate.count} times — ${said}`,
    );
    console.error("");
  }
  console.error(
    `${TAG} A SUBCLASS declaring its own is an override, not a duplicate — only declarations on one\n` +
      `        class body are counted here.\n`,
  );
}

if (unwatchedFields.length > 0) {
  console.error(`\n${TAG} ${unwatchedFields.length} component(s) reading a form field they do not watch:\n`);
  for (const unwatched of unwatchedFields) {
    console.error(`  ${unwatched.file}:${unwatched.line}:${unwatched.column}`);
    console.error(
      `    <${unwatched.component}> reads \`${unwatched.member}\` from a field in its props, so it will\n` +
        `    never show a change to it — the component does not re-render at all.`,
    );
    console.error("");
  }
  console.error(
    `Two deliberate things make that so: a field node is ONE object for the life of the form, so the\n` +
      `props diff has nothing to notice and skips the component; and a hook's state belongs to whoever\n` +
      `used the hook, so the form's counter wakes the form's owner and nobody else.\n\n` +
      `Watch the field, and the component wakes when that one field changes:\n\n` +
      `    f = this.use(Field<string>, () => ({ of: this.props.of }));\n` +
      `    render() { return <input {...this.f.bind} />; }\n\n` +
      `A component that only WRITES through a field is correct as written and is not reported.\n`,
  );
}

process.exit(1);
