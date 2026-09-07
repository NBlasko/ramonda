import { type Imported, namedSites, syntaxesIn } from "./references";
import { readBlock } from "./read";
import { type Finding, checkBlock, checkText } from "./rules";
import { findBlocks } from "./scan";

/**
 * Everything the CSS rules say about one FILE's blocks.
 *
 * There is one of this for the same reason there is one `transform`: the sequence is not obvious and
 * every part of it is load-bearing. Finding the sites, resolving a reference to a named site so it
 * reads as the name it compiles to rather than as a hole, asking the TEXT as well as the parse
 * because one of them has no name for a `//`, and passing the references on so a variable set by one
 * name and read by another can be told apart. Written out a second time, any one of those is a place
 * for two answers to the same question.
 *
 * **It was written out twice before this existed** — in `ramonda-check` and, differently, in the
 * documentation gate, which called the framework's checker and no CSS rule at all. So a doc example
 * could carry a CSS fault and pass: measured, `background: var(--ackcent)` beside `--accent: …` was
 * clean to the gate. That was survivable while a build compiled such a block anyway; it stopped being
 * survivable the moment the build began refusing them, because the gate would then be publishing
 * examples that break a reader's build.
 *
 * A block the PARSER refuses is a different thing and is not caught here — it throws, and the caller
 * decides whether that is a refusal to report or a file to skip.
 */
export function checkSource(source: string, fileName: string, read?: Imported["read"]): Finding[] {
  const out: Finding[] = [];
  // The same reader the build uses, or none — and none means a cross-module reference stays a hole,
  // which `hole-as-a-variable-name` reports. A checker that resolved less than the build would call
  // a working theme a fault; one that resolved more would miss one. Both consumers pass the same.
  const references = namedSites(source, { filename: fileName, read });
  // What each registered property may HOLD, beside what it is called — see `syntaxesIn`.
  const syntaxes = syntaxesIn(source);

  for (const site of findBlocks(source)) {
    const read = readBlock(source, site.open, fileName, { resolve: (name) => references.get(name) });
    out.push(...checkText(source, site.open, read.end), ...checkBlock(read.block, site.at, references, syntaxes));
  }

  return out;
}
