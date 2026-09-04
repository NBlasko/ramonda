/**
 * The extractor, proved rather than described.
 *
 * Reads a `.tsx` file, finds every ``css`…` `` tagged template in it, and prints the class and the
 * custom properties the build would emit. It exists so the central claim of `DESIGN.md` — that the
 * static half and the dynamic half are separable from the AST alone — is something you can run
 * instead of something you have to believe.
 *
 * It is a prototype and knows it: the tag is matched by NAME, so a local `const css = …` would be
 * picked up. The real thing has to resolve the symbol, which is decision 1 in the design.
 *
 *     node packages/css/prototype-extract.mjs some-file.tsx
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

const file = process.argv[2];
if (file === undefined) {
  console.error("usage: node prototype-extract.mjs <file.tsx>");
  process.exit(1);
}

const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);

/** @type {{ className: string; css: string; holes: [string, string][] }[]} */
const blocks = [];

function visit(node) {
  if (ts.isTaggedTemplateExpression(node) && node.tag.getText() === "css") {
    const template = node.template;
    const chunks = [];
    const holes = [];

    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      chunks.push(template.text);
    } else {
      chunks.push(template.head.text);
      for (const span of template.templateSpans) {
        holes.push(span.expression.getText());
        chunks.push(span.literal.text);
      }
    }

    // Every hole becomes a custom property, so what is left is static by construction.
    let text = chunks[0];
    holes.forEach((_, index) => {
      text += `var(--r${index})${chunks[index + 1]}`;
    });

    const normalised = text.replace(/\s+/g, " ").trim();
    blocks.push({
      // The name is the hash of the block, not of the file — so two identical blocks anywhere in
      // the app share one class, and the name does not move when the build order does.
      className: `r-${createHash("sha256").update(normalised).digest("hex").slice(0, 8)}`,
      css: normalised,
      holes: holes.map((expression, index) => [`--r${index}`, expression]),
    });
  }
  ts.forEachChild(node, visit);
}

visit(source);

for (const block of blocks) {
  console.log(`.${block.className} { ${block.css} }`);
  if (block.holes.length > 0) {
    const pairs = block.holes.map(([name, expression]) => `"${name}": ${expression}`).join(", ");
    console.log(`   style -> { ${pairs} }`);
  }
  console.log();
}
