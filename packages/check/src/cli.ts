#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeProject } from "./analyze";

/**
 * `ramonda-check [tsconfig]`
 *
 * Reads your source and reports two things a running page would not tell you:
 *
 * - a context consumer with no provider above it on some path the source can produce — the page
 *   renders, the context quietly falls back to its default, and the numbers are wrong;
 * - a class field holding a function literal, which in Ramonda is a closure per instance for
 *   nothing, since every method is already bound.
 *
 * Meant to sit in an app's `build` script: a check nobody runs is a check that does not exist.
 */
const arg = process.argv[2];
const tsconfig = resolve(arg ?? "tsconfig.json");
const TAG = "[ramonda-check]";

if (!existsSync(tsconfig)) {
  console.error(`${TAG} no tsconfig at ${tsconfig}. Pass one: ramonda-check <path>`);
  process.exit(2);
}

const { issues, arrowFields, duplicateDecorators, counts, notes } = analyzeProject(tsconfig);

for (const note of notes) console.warn(`${TAG} ${note}`);

if (issues.length === 0 && arrowFields.length === 0 && duplicateDecorators.length === 0) {
  console.log(
    `${TAG} ${counts.components} components, ${counts.contexts} contexts, ${counts.roots} root(s) — ` +
      `every consumer has a provider above it, no class field holds a function literal, and no ` +
      `single-use decorator is declared twice.`,
  );
  process.exit(0);
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
    console.error(`  ${duplicate.file}:${duplicate.line}:${duplicate.column}`);
    console.error(
      `    <${duplicate.component}> declares @${duplicate.decorator} ${duplicate.count} times — ` +
        `there is one answer to what it asks, so the last wins and the others never run.`,
    );
    console.error("");
  }
  console.error(
    `${TAG} A SUBCLASS declaring its own is an override, not a duplicate — only declarations on one\n` +
      `        class body are counted here.\n`,
  );
}

process.exit(1);
