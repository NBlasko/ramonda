import ts from "typescript";
import { positionOf } from "../syntax";
import { openingOf } from "./element";
import type { ElementRule, JsxElementLike } from "./rule";

/**
 * A `<video>` or `<audio>` with nothing to read instead of listening.
 *
 * Everything else on a page can be read by somebody who cannot hear it. A media element cannot: its
 * content is the sound, and without a `<track>` there is no text of it anywhere — not for a deaf
 * reader, not for somebody with the sound off on a train, and not for the search index either.
 *
 * `<track kind="captions">` is the answer for `<video>` and `kind="descriptions"` for audio-only
 * content; both are read here, along with `subtitles`, which is the same file doing the same job
 * under the name most people know it by.
 *
 * ## Where it goes quiet
 *
 * **A `<video muted>`**, which has no sound to caption — the decorative background loop, which is
 * the commonest `<video>` on a marketing page and would otherwise be the commonest false report.
 *
 * **Anything whose children this cannot read.** `{tracks.map(…)}` may well be the track, so an
 * element whose children include an expression is left alone.
 */
export interface MediaWithNoCaptionsIssue {
  /** `video` or `audio`, because the advice differs slightly. */
  tag: string;
  file: string;
  line: number;
  column: number;
}

/** The `kind` values that carry the words. `chapters` and `metadata` are navigation, not text. */
const CARRIES_THE_WORDS: ReadonlySet<string> = new Set(["captions", "subtitles", "descriptions"]);

/**
 * Whether the children hold a usable `<track>`, or something this cannot read.
 *
 * The two are one answer on purpose: both mean "do not report", and telling them apart would only
 * change a comment nobody reads.
 */
function hasATrackOrCannotTell(children: readonly ts.JsxChild[]): boolean {
  for (const child of children) {
    if (ts.isJsxExpression(child) && child.expression !== undefined) return true;
    if (ts.isJsxFragment(child) && hasATrackOrCannotTell(child.children)) return true;

    if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) continue;
    const opening = ts.isJsxElement(child) ? child.openingElement : child;
    const name = opening.tagName.getText();

    // A component may render the track, and what it renders is decided elsewhere.
    if (/^[A-Z]/.test(name) || name.includes(".")) return true;
    if (name.toLowerCase() !== "track") continue;

    // A `<track>` with no readable `kind` is one this cannot judge, so it counts.
    const kind = kindOf(opening);
    if (kind === undefined || CARRIES_THE_WORDS.has(kind)) return true;
  }
  return false;
}

/** A `<track>`'s `kind`, lowercased, when it is written as a literal. */
function kindOf(opening: ts.JsxOpeningLikeElement): string | undefined {
  for (const attribute of opening.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) return undefined;
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText().toLowerCase() !== "kind") continue;

    const value = attribute.initializer;
    if (value === undefined) return undefined;
    if (ts.isStringLiteral(value)) return value.text.toLowerCase();
    if (ts.isJsxExpression(value) && value.expression && ts.isStringLiteralLike(value.expression)) {
      return value.expression.text.toLowerCase();
    }
    return undefined;
  }
  // No `kind` at all defaults to `subtitles`, which carries the words.
  return "subtitles";
}

export const mediaWithNoCaptions = {
  id: "media-with-no-captions",

  report: {
    severity: "warn",
    reportedWhen: "a `video` or `audio` element carries no `<track>`, so its content exists only as sound",
    heading: (found) => `${found.length} media element(s) with no text of what is said:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag}> has no \`<track>\` — its content exists only as sound.`,
    ],
    advice:
      "Everything else on a page can be read by somebody who cannot hear it. A media element cannot:\n" +
      "its content IS the sound, and without a track there is no text of it anywhere — not for a\n" +
      "deaf reader, not for somebody with the sound off, and not for the search index.\n\n" +
      'Add `<track kind="captions" src=… srcLang=… label=… />` inside the element. For audio-only\n' +
      'content `kind="descriptions"` is the one that carries the words; `subtitles` is the same\n' +
      "file under the name most people know.\n\n" +
      "A `<video muted>` is NOT reported — there is no sound to caption, which is the decorative\n" +
      "background loop and not this fault.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag, has, children }) {
    if (tag !== "video" && tag !== "audio") return [];

    // No sound, nothing to caption. The decorative background loop, which would otherwise be the
    // commonest false report this rule could make.
    if (tag === "video" && has("muted")) return [];

    if (hasATrackOrCannotTell(children)) return [];

    return [{ tag, ...positionOf(openingOf(element as JsxElementLike)) }];
  },
} as const satisfies ElementRule<MediaWithNoCaptionsIssue>;
