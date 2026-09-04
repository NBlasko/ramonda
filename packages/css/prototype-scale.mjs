/**
 * What a component rendered N times actually costs, and what scoping the variable names costs on
 * top of it.
 *
 * Two questions this answers, both of which decide the design rather than decorating it:
 *
 *   1. **Does the stylesheet grow with instances?** It must not. A class is emitted once per BLOCK
 *      in the source; a component mapped ten thousand times is still one rule.
 *   2. **What do block-scoped variable names cost?** `--r0` is short and collides between nested
 *      blocks; `--r8e271c6c0` cannot collide with anything. The difference is paid once per
 *      instance, in the HTML, which is the one place per-instance cost is real.
 *
 * The third row of the second question is the surprise: names REPEAT, so gzip removes the
 * difference entirely. A longer hash costs nothing over the wire, which is why the recommendation
 * is 16 hex characters rather than the shortest name that seems to work.
 *
 *     node packages/css/prototype-scale.mjs [instances]
 */
import { gzipSync } from "node:zlib";

const INSTANCES = Number(process.argv[2] ?? 10000);

const CLASS = "r-8e271c6c";

const positional = (value) => `<div class="${CLASS}" style="--r0: ${value};"></div>`;
const scoped = (value) => `<div class="${CLASS}" style="--${CLASS}-0: ${value};"></div>`;
const staticOnly = () => `<div class="${CLASS}"></div>`;

const rule = `.${CLASS}{display:flex;flex-direction:column;padding:24px;background-color:#0f172a;border-left:var(--r0)}`;

/**
 * Values VARY between instances, because identical repetition is gzip's best case and would flatter
 * every row here. Only the names repeat, which is the part being compared.
 */
function build(make) {
  let html = "";
  for (let i = 0; i < INSTANCES; i++) html += make(`4px solid #${(0x100000 + i * 7919).toString(16).slice(-6)}`);
  return html;
}

function report(label, make) {
  const html = build(make);
  const raw = Buffer.byteLength(html);
  const zip = gzipSync(html).length;
  console.log(
    `${label.padEnd(28)} ${(raw / 1024).toFixed(1).padStart(9)} KB ${(zip / 1024).toFixed(1).padStart(9)} KB gz   ${(raw / INSTANCES).toFixed(0).padStart(4)} B/instance`,
  );
  return { raw, zip };
}

console.log(`One block, rendered ${INSTANCES.toLocaleString("en-US")} times.\n`);
console.log(`stylesheet                ${(Buffer.byteLength(rule) / 1024).toFixed(2)} KB — ONE rule, whatever N is\n`);

console.log(`${"".padEnd(28)} ${"raw".padStart(9)}    ${"gzipped".padStart(9)}`);
const a = report("static block, no holes", staticOnly);
const b = report("hole, positional --r0", positional);
const c = report("hole, block-scoped name", scoped);

console.log(
  `\nscoping costs        ${(((c.raw - b.raw) / b.raw) * 100).toFixed(1)}% raw, ${(((c.zip - b.zip) / b.zip) * 100).toFixed(1)}% gzipped`,
);
console.log(
  `a hole costs         ${(((b.raw - a.raw) / a.raw) * 100).toFixed(1)}% raw, ${(((b.zip - a.zip) / a.zip) * 100).toFixed(1)}% gzipped over a static block`,
);
