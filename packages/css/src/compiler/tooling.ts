import { canonicalDeclaration, canonicalPrelude } from "./normalise";
import { MATCH, closingHole, opensCode, readBlock } from "./read";
import { findBlocks, mayHoldABlock } from "./scan";

/**
 * An escape with its parens against the expression, whatever was typed.
 *
 * **Reported by a user, who had the same condition four ways in one file** — loose and tight on each
 * side — because the formatter left every one of them alone. Measured before this: all four survived
 * unchanged.
 *
 * Tight, because `$( … )` is a delimiter, as a call's parens are, and a call is written tight. The
 * whitespace just inside the parens is not part of the expression, so trimming it changes nothing
 * that runs. An expression that begins or ends with a brace is closed up like any other: with `{ }`
 * as the escape it kept its space, because closing it up wrote `{{`, and `$({` cannot be misread.
 */
function tightened(hole: string, expression: PlaceholdOptions["expression"]): string {
  // `$(` and `)` around it.
  const inner = hole.slice(2, -1);
  const trimmed = inner.trim();

  const laid = expression === undefined ? trimmed : formattedExpression(trimmed, expression);
  return laid === inner ? hole : `$(${laid})`;
}

/**
 * One hole's expression, laid out by the PROJECT's formatter — or exactly as the author wrote it.
 *
 * **Reported by a user**: *"formating unutar rupe ne radi"*, on
 * `color: {this.toggle ? $color.accent.quiet    : $color.accent.main}`. The braces were closed up
 * and the interior was untouched, so the one part of a block that IS ordinary TypeScript was the
 * one part escaping the formatter — while `ramonda-css format` exists precisely so a file carrying
 * blocks is laid out by the project's own tools.
 *
 * Handed over ALONE rather than formatting the file twice, because the expression is not a file: it
 * is wrapped as a statement, formatted, and unwrapped. The parens are what make an expression a
 * statement whatever it is — an object literal at the start of a line is a block otherwise.
 *
 * ## The two answers that are declined, and why declining is right
 *
 * **A result that spans lines.** The layout above puts one declaration on a line and steps over a
 * hole as one unit, so a newline inside one would be spliced into the middle of a line — the
 * author's code, rearranged into something they did not write. A formatter breaking a long ternary
 * across lines is doing its job; this simply cannot place the answer.
 *
 * **A formatter that throws.** A broken `biome.json` is a setup fault the CLI already says out loud.
 * Losing the author's expression over it would be this tool doing damage while reporting nothing.
 */
function formattedExpression(text: string, format: (text: string) => string): string {
  let out: string;
  try {
    out = format(`(\n${text}\n);\n`);
  } catch {
    return text;
  }

  const trimmed = out.trim().replace(/;$/, "").trim();
  const unwrapped = trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed.slice(1, -1).trim() : trimmed;

  if (unwrapped === "" || /[\r\n]/.test(unwrapped)) return text;
  return unwrapped;
}

/**
 * Handing a style block to a formatter, which is a different problem from handing it to a checker.
 *
 * ## Why this is not the virtual file
 *
 * A linter gets the virtual file and its diagnostics are mapped home, exactly as `tsc`'s are — one
 * mechanism, already written. A formatter cannot work that way: it **rewrites text** rather than
 * reporting positions in it, so there is nothing to map back through. What comes out is a new file,
 * and the block has to be in it.
 *
 * So the block is replaced by something that parses, the file is formatted normally, and the block is
 * put back where the placeholder ended up.
 *
 * ## And a suppression comment cannot substitute for either half
 *
 * `biome-ignore` and `oxlint-disable` are read BY the parser, and the parser fails before it reaches
 * them. Measured: biome answers *"Code formatting aborted due to parsing errors"* with the comments
 * in place. It is also what makes the comparison with a CSS-in-a-backtick library misleading — a
 * tagged template is already valid TypeScript, so the tool parses the file, sees a string and looks
 * no further. Here there is no region to ignore, because there is no region at all.
 */

export interface Placeheld {
  /** The file with every block replaced by something that parses. Hand this to the formatter. */
  readonly text: string;
  /**
   * Each block's own `@@( … )` text, in the order the placeholders were numbered — never the name in
   * front of it, even where the placeholder took that too. A caller printing a placeholder back is
   * printing it INSIDE whatever the placeholder occupies, so the name is already there.
   */
  readonly blocks: readonly string[];
  /** The formatter's output with the blocks put back, at the indentation it chose. */
  restore(formatted: string): string;
}

export interface PlaceholdOptions {
  /**
   * What stands in for a block, given its number and whether the block spans lines. The default is
   * a comment and a zero for a one-line block, and a template literal holding a newline for one
   * that spans lines — see `placehold` for why the shape has to carry that much.
   *
   * A caller that puts the block back ITSELF wants something else. Prettier is the one that does —
   * it has no hook that sees the printed text, so its plugin recognises the placeholder as a NODE
   * and prints the block in its place, which needs a node rather than a comment on one.
   */
  stands?(index: number, multiline: boolean): string;
  /**
   * How to format ONE hole's expression — the project's own formatter, given a wrapped statement.
   *
   * Absent, a hole's interior is left exactly as the author wrote it, which is what every caller but
   * `formatText` wants: a checker, a linter and the editor all read the author's text and must not
   * see it rewritten. Only the command whose job is to format has an opinion here, and the opinion
   * it has is the project's.
   */
  expression?(text: string): string;
  /**
   * Whether a bare JSX attribute keeps the braces the placeholder needs.
   *
   * True by default, which is what a formatter run over the whole file wants: a commented zero in
   * braces is a legal attribute value, and `restore` puts the author's own spelling back afterwards.
   *
   * A caller whose placeholder is a value in its own right can do better — a quoted string is a legal
   * attribute value too, so nothing about the site changes and the block goes back exactly as it was
   * written.
   */
  braces?: boolean;
}

/** `undefined` when the file holds no block, which is when a formatter needs no help. */
export function placehold(source: string, options: PlaceholdOptions = {}): Placeheld | undefined {
  if (!mayHoldABlock(source)) return undefined;

  const sites = findBlocks(source);
  if (sites.length === 0) return undefined;

  const marker = markerFor(source);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  /**
   * A placeholder has to carry the block's SHAPE, not only its place.
   *
   * **Reported by a user**: `className="panel"` and `css={@@( … )}` could not be kept one per line —
   * "kao da nas eteti tera ostale da idu inline". They were right, and it was ours. The formatter
   * never sees a block, it sees this; and a comment and a zero is fourteen characters, so an opening
   * element that is multi-line in the author's file measured as fitting on one. biome joined the
   * attributes exactly as it should have, and the block was expanded again afterwards, past a width
   * nobody re-measured. An element carrying a block and one other attribute is the ordinary case.
   *
   * So a block that spans lines is placeheld by something that spans lines. A template literal,
   * because its contents are the one thing a formatter will not re-lay: measured against the two
   * alternatives, a multi-line comment and a padded one both make biome break the braces open —
   * `css={` on its own line, which the author did not write either.
   *
   * A ONE-LINE block keeps the short placeholder. `css=@@( display: flex; )` beside another
   * attribute is a line the author chose, and whether it still fits is the formatter's own call.
   */
  const stands =
    options.stands ??
    ((index: number, multiline: boolean) =>
      multiline ? `\`${marker}${index}${newline}\`` : `/*${marker}${index}*/ 0`);
  const blocks: { text: string; block: string; wrap: boolean; held: string }[] = [];
  let text = "";
  let cursor = 0;

  for (const site of sites) {
    if (site.start < cursor) continue;

    // Tolerant: a formatter is the tool most likely to run on a file mid-edit — save on keystroke —
    // and refusing there would be refusing whenever it matters most.
    const read = readBlock(source, site.open, "", { tolerant: true });
    const end = read.end + 1;
    /**
     * What the site owns, which is the transform's rule and has to be: a bare JSX attribute owns its
     * name, because the braces are ours to add; the two expression spellings own only the block. A
     * placeholder that swallowed the author's own `}` in `css={@@( … )}` leaves an extra one behind —
     * measured, biome then refuses the file for the very parse error this exists to avoid.
     */
    const wrap = site.wrap && options.braces !== false;
    const from = site.start;
    const block = source.slice(site.opening, end);
    const held = stands(blocks.length, block.includes("\n"));

    text += source.slice(cursor, from);
    text += wrap ? `${site.name}={${held}}` : held;
    blocks.push({ text: source.slice(from, end), block, wrap, held });
    cursor = end;
  }

  text += source.slice(cursor);

  return {
    text,
    blocks: blocks.map((held) => held.block),
    restore: (formatted) => restore(formatted, blocks, options.expression),
  };
}

function restore(
  formatted: string,
  blocks: readonly { text: string; wrap: boolean; held: string }[],
  expression: PlaceholdOptions["expression"],
): string {
  let out = formatted;
  /**
   * The ending the FORMATTER chose, which is the one the whole file now uses.
   *
   * `relaid` used to take it from the block's own text, and a review measured what that costs: a
   * CRLF file formatted by a tool that writes LF came back LF outside every block and CRLF inside
   * one. Stable, which is worse than random — it recurs on every save rather than healing.
   *
   * The existing tests could not see it, because they all use an identity formatter, and an identity
   * formatter never disagrees with the block. A tool with an opinion is the only way to reach it.
   *
   * A file with one line and no newline at all keeps whatever the block had, which is the only case
   * where the formatter has said nothing.
   */
  const newline = formatted.includes("\r\n") ? "\r\n" : formatted.includes("\n") ? "\n" : undefined;
  // From the text as the FORMATTER left it, before any block goes back into it — a restored block's
  // own body would otherwise be read as evidence of what the formatter chose.
  const spaces = stepOf(formatted);

  for (const block of blocks) {
    /**
     * Built from what was actually emitted rather than from a second spelling of it — the caller may
     * have supplied its own `stands`, and two descriptions of one placeholder is this repository's
     * recurring fault in miniature. A newline is matched either way it survives the formatter, which
     * may have written the file back with the other ending.
     */
    const stands = block.held.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\r?\n/g, "\\r?\\n");
    const placeholder = new RegExp(block.wrap ? `[\\w:$-]+=\\{${stands}\\}` : stands);
    const found = placeholder.exec(out);
    /**
     * A placeholder the formatter moved, rewrote or deleted. There is no correct output to fall back
     * to, so there is no output.
     *
     * This used to `continue`: the block was dropped, the placeholder was left where it had been,
     * and `formatFile` with `write: true` put that on disk. A review measured it with the real
     * Prettier, which reads the template placeholder as embedded CSS and reflows it — two of six
     * cases lost their block.
     *
     * A formatter that fails is an inconvenience. A formatter that eats a block is unrecoverable
     * work, and it was doing it silently, which is the half that makes it unrecoverable. The test
     * that covered the old behaviour asserted the block was gone while its own comment said losing
     * an author's source is the one outcome this may not have; the comment was right.
     */
    if (found === null) {
      throw new Error(
        "[@ramonda/css] the formatter moved or rewrote the placeholder standing in for a style " +
          "block, so the block cannot be put back and nothing was written. This is a formatter " +
          "this package has not been measured against — please report it with the file.",
      );
    }

    /**
     * And a placeholder that came back TWICE, which left ours in the author's file.
     *
     * The same fault from the other side, and it was not refused: `exec` finds the first match, the
     * block went back there, and the second kept the marker — this package's own internal text,
     * written to somebody's component. Found by probing what `restore` does when the text it gets
     * back is not the text it handed over.
     *
     * No formatter measured here duplicates code. That is exactly the argument the missing case
     * refused to accept, for the reason written above it: there is no correct output to fall back
     * to, so there is no output.
     */
    if (placeholder.test(out.slice(found.index + found[0].length))) {
      throw new Error(
        "[@ramonda/css] the formatter left more than one copy of the placeholder standing in for a " +
          "style block, so there is no one place to put the block back and nothing was written. " +
          "This is a formatter this package has not been measured against — please report it with " +
          "the file.",
      );
    }

    /**
     * The formatter's own indentation, copied rather than counted.
     *
     * It may have chosen tabs, and a block re-laid with spaces inside a tabbed file is a file the
     * formatter will disagree with on the next run — an edit that never settles.
     */
    const lineStart = out.lastIndexOf("\n", found.index) + 1;
    const outer = /^[\t ]*/.exec(out.slice(lineStart, found.index))?.[0] ?? "";
    const inner = outer + (outer.includes("\t") ? "\t" : spaces);

    out =
      out.slice(0, found.index) +
      relaid(block.text, outer, inner, newline, expression) +
      out.slice(found.index + found[0].length);
  }

  return out;
}

/**
 * How wide one level is, read off the file the formatter has just laid out.
 *
 * **The config used to have a `format: { indent }` for this, and nothing read it.** Wiring it up
 * would have been the wrong repair: the project has already told biome or prettier how wide a level
 * is, and a second place to say it can only disagree with the first. This asks the answer that is
 * already in the file.
 *
 * ## What it counts, and why it is not the narrowest line
 *
 * It used to take the NARROWEST indentation anywhere in the file, on the reasoning that the
 * shallowest indented line is one level in. That is true of code and false of everything else a file
 * holds: **one two-space line inside a template literal or a wrapped comment dropped every block in
 * a four-space file to a two-space step**, permanently and idempotently, and the doc above it named
 * that hazard while guarding only a single space. Mine, and a review found it.
 *
 * What one level IS is a DIFFERENCE — the amount a line indents past the one above it — so that is
 * what is counted, and the commonest difference wins. A stray line is then one vote against many
 * instead of the whole answer. Measured over ten shapes: the narrowest reading is wrong on three of
 * them, this is wrong on none.
 *
 * Lines inside a template literal or a block comment are left out, which is the one case counting
 * differences does not survive on its own — a long embedded query indented two spaces in a
 * four-space file has more steps in it than the code around it. The scan is by line and approximate
 * on purpose: a wrong guess costs a vote, not the answer.
 *
 * Two spaces when there is nothing to read at all.
 */
function stepOf(text: string): string {
  const counts = new Map<number, number>();
  let previous = 0;
  let inTemplate = false;
  let inComment = false;

  for (const line of text.split("\n")) {
    const quiet = inTemplate || inComment;
    let ticks = 0;
    for (let index = 0; index < line.length; index++) {
      if (!inTemplate && line.startsWith("/*", index)) inComment = true;
      else if (inComment && line.startsWith("*/", index)) inComment = false;
      else if (!inComment && line.charCodeAt(index) === 96 /* ` */) ticks++;
    }
    if (ticks % 2 === 1) inTemplate = !inTemplate;
    if (quiet || line.trim() === "") continue;

    const width = /^[ ]*/.exec(line)?.[0].length ?? 0;
    const step = width - previous;
    if (step > 0) counts.set(step, (counts.get(step) ?? 0) + 1);
    previous = width;
  }

  let best = 0;
  let most = 0;
  // A tie goes to the NARROWER step: two levels of four look like one of eight to a counter, and
  // the smaller reading is the one that cannot have swallowed a level.
  for (const [step, count] of counts) if (count > most || (count === most && step < best)) [best, most] = [step, count];

  return " ".repeat(best === 0 ? 2 : best);
}

/**
 * One block at the indentation the formatter settled on, and its CSS laid out inside that.
 *
 * The first line stays as it is — it begins where the placeholder was, which the formatter has
 * already positioned. Everything after it is re-laid, and the last line closes what the first opened.
 *
 * **A one-line block is returned untouched.** `css=@@( display: flex; )` is a deliberate shape and
 * breaking it would be the formatter having an opinion about the markup rather than about the CSS.
 *
 * **The block's own line ending is what it is put back together with.** Splitting on `\n` and
 * joining on `\n` cost every body line its `\r` in a CRLF checkout — measured with an identity
 * formatter, which is the only way to see it: the file came back with mixed endings inside each
 * block, a diff on every line and a lint failure in most setups. Nothing here is a decision about
 * which ending a file should use.
 */
function relaid(
  block: string,
  outer: string,
  inner: string,
  chosen: string | undefined,
  expression: PlaceholdOptions["expression"],
): string {
  // The file's own ending — see `restore`, which reads it off what the formatter handed back. Only a
  // file with no newline at all falls back to the block's, because there the formatter said nothing.
  const newline = chosen ?? (block.includes("\r\n") ? "\r\n" : "\n");
  const lines = block.split(/\r?\n/);
  if (lines.length === 1) return block;

  const step = inner.slice(outer.length);
  const body = lines.slice(1, -1).join(newline);

  return [lines[0], ...layout(body, inner, step, expression), outer + lines[lines.length - 1].trim()].join(newline);
}

/**
 * A whole block — \`@@(\` to \`)\` — with its inside laid out one \`step\` in, the way \`relaid\` lays
 * it out in a file. For a printer that places the block itself and wants the CSS done the same way:
 * the Prettier plugin, which handed the inside back as written until a review found a Prettier
 * project had no road to this layout at all. A one-line block is returned untouched, as there.
 */
export function relaidInside(block: string, step: string): string {
  const lines = block.split(/\r?\n/);
  if (lines.length === 1) return block;
  const body = lines.slice(1, -1).join("\n");
  return [lines[0], ...layout(body, step, step, undefined), lines[lines.length - 1].trim()].join("\n");
}

/**
 * The CSS between a block's parens, one declaration to a line and a nested rule's body one step in.
 *
 * ## Why it works on the TEXT rather than on the parse
 *
 * The parser drops comments — measured, a block comment between two declarations is not in the AST at
 * all — so a layout emitted from the parse would delete the author's own notes. Everything here is
 * the author's bytes with the whitespace between them rewritten.
 *
 * ## What is not structure
 *
 * A `;` or a brace inside a hole, a string, a comment or a function is not a boundary, and treating
 * one as a boundary is how a formatter breaks working code. Each of those is stepped over whole,
 * which is also what keeps `$(…)` byte-for-byte: the expression inside it is TypeScript and none
 * of this may touch it.
 */
function layout(body: string, indent: string, step: string, expression: PlaceholdOptions["expression"]): string[] {
  const out: string[] = [];
  let line = "";
  let depth = 0;
  let parens = 0;
  /**
   * Whether this physical line has produced anything yet.
   *
   * Without it, the newline after a `;` reads as a blank line the author wrote — `line` is empty by
   * then, because emitting cleared it — and every declaration gains one below it.
   */
  let fresh = true;
  /** Whether a line was already emitted on this physical line — see the comment branch. */
  let emitted = false;

  /** The line so far, at its depth — or a blank line, which carries no indentation of its own. */
  const emit = (): void => {
    const text = line.trim();
    line = "";
    if (text === "") return;
    out.push(indent + step.repeat(depth) + text);
    emitted = true;
  };

  /** A blank line the author wrote, kept once however many they wrote. */
  const blank = (): void => {
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
  };

  for (let index = 0; index < body.length; index++) {
    const code = body.charCodeAt(index);

    if (code === 47 /* / */ && body.charCodeAt(index + 1) === 42 /* * */) {
      /**
       * A comment on a line of its own stays on one, and one at the end of a declaration stays
       * there. The difference is whether anything came BEFORE it on this line — which is what
       * `fresh` already knows, and what the first version of this got wrong: every standalone
       * comment came back glued to the declaration below it, which is the one thing a note above a
       * declaration must not become.
       */
      const alone = fresh;
      const end = body.indexOf("*/", index + 2);
      const stop = end === -1 ? body.length : end + 2;
      const comment = body.slice(index, stop);
      index = stop - 1;
      fresh = false;

      /**
       * A comment AFTER a declaration belongs to the line it was written on, and by the time it is
       * read that line has already been emitted — the `;` ended it. So it is appended to what was
       * emitted rather than started as a line of its own.
       */
      if (line.trim() === "" && emitted && out.length > 0) {
        out[out.length - 1] += ` ${comment}`;
        continue;
      }

      line += comment;
      if (alone) emit();
      continue;
    }

    if (code !== 10 /* \n */ && code !== 32 && code !== 9) fresh = false;

    if (code === 34 /* " */ || code === 39 /* ' */) {
      const stop = endOfString(body, index);
      line += body.slice(index, stop);
      index = stop - 1;
      continue;
    }

    /**
     * A `match`, which is a THIRD shape beside a declaration and a nested rule.
     *
     * It has to be caught before the hole branch, and that is the whole bug it fixes. `opensAHole`
     * asks whether the text in front of a `{` is a declaration's head — `color:` is, so the `{`
     * that opens a match body was read as a hole, and `closingHole` swallowed every arm as one run
     * of text. Reported by the user, and what came back was:
     *
     *     color: match $(this.tone) {quiet => $color.accent.quiet;
     *       loud  => $color.text.primary;};
     *
     * The arms line up on their `=>`, because a match IS a lookup table and a table reads aligned.
     * The cost is real and is the ordinary cost of alignment: an arm with a longer key than any
     * before it moves the others, so one edit is several lines of diff.
     */
    if (code === 123 /* { */ && OPENS_A_MATCH.test(line)) {
      // `closingHole` answers just PAST the `}`, so the body is what lies between the braces.
      const close = closingHole(body, index);
      const stop = close === -1 ? body.length : close - 1;
      const head = tightenedMatchHead(line.trim(), expression);

      out.push(indent + step.repeat(depth) + `${head} {`);
      for (const arm of armsIn(body.slice(index + 1, stop))) {
        out.push(indent + step.repeat(depth + 1) + arm);
      }

      /**
       * The `;` that ends the DECLARATION rides the closing brace, because that is what it ends.
       * A match is a value, so the declaration holding it is not over until the `;` — and a `;` on
       * a line of its own is the one shape nobody writes.
       */
      let after = stop + 1;
      while (after < body.length && (body.charCodeAt(after) === 32 || body.charCodeAt(after) === 9)) after++;
      const ends = body.charCodeAt(after) === 59; /* ; */
      out.push(indent + step.repeat(depth) + (ends ? "};" : "}"));

      line = "";
      emitted = true;
      fresh = false;
      index = ends ? after : stop;
      continue;
    }

    if (opensCode(body, index)) {
      const close = closingHole(body, index + 1);
      const stop = close === -1 ? body.length : close;
      line += tightened(body.slice(index, stop), expression);
      index = stop - 1;
      continue;
    }

    if (code === 40 /* ( */) {
      parens++;
      line += "(";
      continue;
    }
    if (code === 41 /* ) */) {
      parens = Math.max(0, parens - 1);
      line += ")";
      continue;
    }

    /**
     * A BLOCK match — `match $(t) { hot => ( … ); … }` at the head of an item — laid out as a value
     * match is: one arm to a line, lined up on the arrow, and each arm's declarations inside one
     * pair of parens. See `blockArmsIn`.
     */
    if (parens === 0 && code === 123 /* { */ && OPENS_A_BLOCK_MATCH.test(line.trim())) {
      const close = closingHole(body, index);
      const stop = close === -1 ? body.length : close - 1;
      out.push(indent + step.repeat(depth) + `${tightenedMatchHead(line.trim(), expression)} {`);
      for (const arm of blockArmsIn(body.slice(index + 1, stop))) out.push(indent + step.repeat(depth + 1) + arm);
      out.push(indent + step.repeat(depth) + "}");
      line = "";
      emitted = true;
      fresh = false;
      index = stop;
      continue;
    }

    if (parens === 0 && code === 123 /* { */) {
      /**
       * A branch rides the brace that closes the one before it — `} else {`, `} else when $(b) {` —
       * the way JavaScript writes it, which is the user's choice. Only when that brace is the line
       * right above: a comment between the two is the author's note and keeps its own line.
       */
      const closing = indent + step.repeat(depth) + "}";
      if (/^else\b/.test(line.trim()) && out[out.length - 1] === closing) {
        out[out.length - 1] = `${closing} ${canonicalPrelude(line.trim())} {`;
        line = "";
        emitted = true;
        depth++;
        continue;
      }

      /**
       * A prelude, written the one way it may be written — see `canonicalCondition`.
       *
       * The same functions the `non-canonical-spelling` rule asks, so the rule reports exactly what
       * this writes and the two cannot disagree about what canonical means. That matters more than
       * either half: a rule reporting a spelling the formatter would not fix is an error with no
       * fix, and a formatter rewriting something no rule asked for is a diff nobody wanted.
       */
      line = `${canonicalPrelude(line.trim())} {`;
      emit();
      depth++;
      continue;
    }

    if (parens === 0 && code === 125 /* } */) {
      emit();
      depth = Math.max(0, depth - 1);
      out.push(indent + step.repeat(depth) + "}");
      continue;
    }

    if (parens === 0 && code === 59 /* ; */) {
      /**
       * And the DECLARATION, written the one way it may be written — the other half of the same
       * promise. `non-canonical-spelling` reports a keyword in the wrong case and its message says
       * this fixes it; before this line it did not, which is the shape a review already found in
       * `tools.ts`: two halves of one command disagreeing about one file.
       */
      /** A CHOICE is laid out as a table rather than as one line — see `choiceLines`. */
      const choice = choiceLines(line.trim());
      if (choice !== undefined) {
        for (const one of choice) out.push(indent + step.repeat(depth) + one);
        line = "";
        emitted = true;
        continue;
      }
      line = `${canonicalDeclaration(line.trim())};`;
      emit();
      continue;
    }

    if (code === 10 /* \n */) {
      if (fresh) blank();
      else if (line.trim() !== "") line += " ";
      fresh = true;
      emitted = false;
      continue;
    }

    /**
     * A run of whitespace inside a value is collapsed to one space.
     *
     * Removing whitespace is safe; adding it is an opinion. `rgb(1,2,3)` keeps the spacing the author
     * chose — this only takes away what nobody meant, which is `4px     0   ;`.
     *
     * Only here, and that is the point: a string, a hole and a comment were appended whole further
     * up and are never looked at again, so their own spacing is untouched.
     */
    if (code === 32 || code === 9) {
      if (line !== "" && !line.endsWith(" ")) line += " ";
      continue;
    }

    line += String.fromCharCode(code);
  }

  emit();
  // A trailing blank line would put an empty one before the closing paren, which nobody wrote.
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/**
 * A declaration whose value is a `match(…)` waiting for its body — see where it is used.
 *
 * Anchored at the property, so `color: match $(t)` is one and `background: url(a) match(b)` is not:
 * a match is the WHOLE value or it is not a match, which is what the reader already refuses.
 */
const OPENS_A_MATCH = new RegExp(`:\\s*${MATCH}\\s*\\$\\([\\s\\S]*\\)\\s*$`);

/**
 * The head of a match — `color: match $(…)` — with its subject laid out by the project's tools, and
 * one space between `match` and its escape.
 */
function tightenedMatchHead(line: string, expression: PlaceholdOptions["expression"]): string {
  const open = line.indexOf("$(");
  if (open === -1) return line;
  const close = closingHole(line, open + 1);
  if (close === -1) return line;
  const before = line.slice(0, open).replace(/match\s*$/, "match ");
  return before + tightened(line.slice(open, close), expression) + line.slice(close);
}

/**
 * One match body's arms, one per line, lined up on their `=>`.
 *
 * Split on the `;` that ends each arm, at paren depth zero and outside a string — `red;` ends one
 * and `rgb(0 0 0 / 50%);` does not end in the middle of itself. An arm with no `;` is the last one
 * written without a trailing semicolon, which the reader accepts and which comes back with one.
 */
function armsIn(body: string): string[] {
  const arms: string[] = [];
  let current = "";
  let parens = 0;

  for (let index = 0; index < body.length; index++) {
    const code = body.charCodeAt(index);

    if (code === 34 /* " */ || code === 39 /* ' */) {
      const stop = endOfString(body, index);
      current += body.slice(index, stop);
      index = stop - 1;
      continue;
    }
    if (code === 40 /* ( */) parens++;
    if (code === 41 /* ) */) parens = Math.max(0, parens - 1);
    if (parens === 0 && code === 59 /* ; */) {
      arms.push(current);
      current = "";
      continue;
    }
    current += String.fromCharCode(code);
  }
  arms.push(current);

  /** The key and the value of each arm, with the whitespace the author used taken out. */
  const split = arms
    .map((one) => one.replace(/\s+/g, " ").trim())
    .filter((one) => one !== "")
    .map((one) => {
      const at = one.indexOf("=>");
      return at === -1 ? { key: one, value: "" } : { key: one.slice(0, at).trim(), value: one.slice(at + 2).trim() };
    });

  const widest = split.reduce((width, one) => Math.max(width, one.key.length), 0);
  return split.map(({ key, value }) =>
    value === "" ? `${key};` : `${key.padEnd(widest)} => ${canonicalDeclaration(`x:${value}`).slice(2)};`,
  );
}

/** A block-level match's head: the word at the start of an item, and its subject. */
const OPENS_A_BLOCK_MATCH = new RegExp(`^${MATCH}\\s*\\$\\(`);

/**
 * Where `text` splits at depth zero on `separator` — outside strings, parens, brackets and braces.
 * The pieces, untrimmed; the last one is whatever follows the final separator.
 */
function splitTop(text: string, separator: number): string[] {
  const pieces: string[] = [];
  let current = "";
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 34 /* " */ || code === 39 /* ' */) {
      const stop = endOfString(text, index);
      current += text.slice(index, stop);
      index = stop - 1;
      continue;
    }
    if (opensCode(text, index)) {
      const close = closingHole(text, index + 1);
      const stop = close === -1 ? text.length : close;
      current += text.slice(index, stop);
      index = stop - 1;
      continue;
    }
    if (code === 40 || code === 91 || code === 123) depth++;
    if (code === 41 || code === 93 || code === 125) depth = Math.max(0, depth - 1);
    if (depth === 0 && code === separator) {
      pieces.push(current);
      current = "";
      continue;
    }
    current += String.fromCharCode(code);
  }
  pieces.push(current);
  return pieces;
}

/** A value with the parens around ALL of it taken off — `(2px solid red)`, never `(1px) + (2px)`. */
function unwrapped(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("(")) return trimmed;
  let depth = 0;
  for (let index = 0; index < trimmed.length; index++) {
    const code = trimmed.charCodeAt(index);
    if (code === 34 || code === 39) {
      index = endOfString(trimmed, index) - 1;
      continue;
    }
    if (code === 40) depth++;
    if (code === 41) {
      depth--;
      if (depth === 0) return index === trimmed.length - 1 ? trimmed.slice(1, -1).trim() : trimmed;
    }
  }
  return trimmed;
}

/** A value as the formatter writes it anywhere — the same function a declaration goes through. */
const valueLaid = (value: string): string => canonicalDeclaration(`x:${value.replace(/\s+/g, " ").trim()}`).slice(2);

/**
 * A block match's arms: the key, the arrow lined up, and the arm's declarations inside one pair of
 * parens with a space each side — `( )` for an empty one. A nested rule inside an arm keeps its
 * text with the whitespace collapsed; it is rare, and laying it out over lines would break the table.
 */
function blockArmsIn(body: string): string[] {
  const arms = splitTop(body, 59 /* ; */)
    .map((one) => one.replace(/\s+/g, " ").trim())
    .filter((one) => one !== "")
    .map((one) => {
      const at = one.indexOf("=>");
      if (at === -1) return { key: one, inside: undefined };
      const inside = splitTop(unwrapped(one.slice(at + 2)), 59)
        .map((piece) => piece.trim())
        .filter((piece) => piece !== "")
        .map((piece) => {
          if (piece.includes("{")) return piece;
          const colon = splitTop(piece, 58 /* : */);
          return colon.length < 2 ? `${piece};` : `${colon[0].trim()}: ${valueLaid(colon.slice(1).join(":"))};`;
        });
      return { key: one.slice(0, at).trim(), inside };
    });

  const widest = arms.reduce((width, one) => Math.max(width, one.key.length), 0);
  return arms.map(({ key, inside }) =>
    inside === undefined
      ? `${key};`
      : `${key.padEnd(widest)} => ( ${inside.length === 0 ? "" : `${inside.join(" ")} `});`,
  );
}

/**
 * A declaration whose value is a CHOICE, as the lines it is written on — or nothing for any other.
 *
 * One condition is one line: `border: $(on) ? 2px solid red : 1px solid #ccc;`. A chain is a table,
 * the user's choice: every new line starts with `:` under the declaration's colon, the `?`s line
 * up, the values make a column and the last value sits in it too. Parens around a whole branch come
 * off — the reader accepts them, and they are not the canonical spelling.
 */
function choiceLines(declaration: string): string[] | undefined {
  const [property, ...rest] = splitTop(declaration, 58 /* : */);
  if (rest.length === 0) return undefined;
  let value = rest.join(":").trim();
  const name = property.trim();

  const conditions: string[] = [];
  const values: string[] = [];
  for (;;) {
    if (!opensCode(value, 0)) break;
    const close = closingHole(value, 1);
    if (close === -1) return undefined;
    const after = value.slice(close).trimStart();
    if (!after.startsWith("?")) break;
    conditions.push(value.slice(0, close));
    const [branch, ...others] = splitTop(after.slice(1), 58 /* : */);
    if (others.length === 0) return undefined;
    values.push(valueLaid(unwrapped(branch)));
    value = others.join(":").trim();
  }
  if (conditions.length === 0) return undefined;
  const last = valueLaid(unwrapped(value));

  if (conditions.length === 1) return [`${name}: ${conditions[0]} ? ${values[0]} : ${last};`];

  const widest = conditions.reduce((width, one) => Math.max(width, one.length), 0);
  const under = " ".repeat(name.length);
  return [
    ...conditions.map((one, index) =>
      index === 0
        ? `${name}: ${one.padEnd(widest)} ? ${values[index]}`
        : `${under}: ${one.padEnd(widest)} ? ${values[index]}`,
    ),
    `${under}: ${" ".repeat(widest + 3)}${last};`,
  ];
}

/** Past the closing quote of the string starting at `at`, or the end of the text. */
function endOfString(text: string, at: number): number {
  const quote = text.charCodeAt(at);
  for (let index = at + 1; index < text.length; index++) {
    if (text.charCodeAt(index) === 92 /* \\ */) index++;
    else if (text.charCodeAt(index) === quote) return index + 1;
  }
  return text.length;
}

/**
 * A marker the file does not already contain.
 *
 * It goes into the text the FORMATTER sees, so an author who happened to write the same characters
 * would get somebody else's block back where theirs was. Growing it until the file does not hold it
 * costs one search and removes the question.
 *
 * **Exported because the Prettier plugin supplies its own `stands` and used a CONSTANT.** Measured:
 * a file with a block in it and `` const note = `@ramonda-css-block:0` `` anywhere else came back
 * with that string replaced by a copy of the block — the author's own text, gone. The guarantee was
 * written for the default and covered only the default.
 */
export function markerFor(source: string, base = "@ramonda-css:"): string {
  let marker = base;
  while (source.includes(marker)) marker += "!";
  return marker;
}
