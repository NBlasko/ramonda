import ts from "typescript";
import { positionOf } from "../syntax";
import { descendantIn } from "./descendants";
import { contextFor, openingOf } from "./element";
import type { ElementContext, ElementRule, JsxElementLike } from "./rule";

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
 * A `<audio muted>` is deliberately NOT the same and is still reported, which reads like an
 * oversight and is not. The escape above is about the decorative loop: autoplaying, silent by
 * design, nothing to hear at any point. A muted `<audio>` is not that — it is audio somebody will
 * unmute with the controls, so the words are still coming and there is still nothing to read them
 * in. Measured before writing this down, on a plant that reported the `<audio>` and cleared the
 * `<video>` beside it.
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
 * The two are one answer to the CALLER — both mean "do not report" — but they are kept apart on the
 * way out, because `descendantIn`'s matcher has three answers and flattening them would make a
 * track this cannot judge look like one it judged and cleared.
 *
 * Reads the child through `contextFor` rather than walking its attributes, which is what lets a
 * `kind` held in a NAME be followed to the value it holds. Written as its own walk it accepted only
 * a literal, so `<track kind={CHAPTERS}>` with `const CHAPTERS = "chapters"` counted as a usable
 * track and silenced the report — the same claim as `kind="chapters"` one name away, measured on a
 * plant. That was this file's own copy of a reader the package already had.
 */
function hasATrackOrCannotTell(children: readonly ts.JsxChild[], resolve: ElementContext["resolve"]): boolean {
  return (
    descendantIn(children, (child, tag) => {
      if (tag !== "track") return false;

      const { has, attr, spreads } = contextFor(child, resolve);

      // No `kind` at all defaults to `subtitles`, which carries the words.
      if (!has("kind")) return true;

      // A spread may carry the `kind` or replace the one written, and then this track is not one
      // anything here can judge.
      if (spreads) return "unreadable";

      const kind = attr("kind")?.trim().toLowerCase();
      // Written and unreadable — `kind={whichever}` — is a track this cannot judge either.
      if (kind === undefined) return "unreadable";

      return CARRIES_THE_WORDS.has(kind);
    }) !== "none"
  );
}

/**
 * Whether the element says what it is, for a reader who cannot hear it.
 *
 * `truth` answers `undefined` for anything it cannot read, which is what makes
 * `aria-label={title}` count: a name computed at runtime is a name. Only the empty string is
 * refused, because that is a label written and nothing said.
 */
function labelled(has: ElementContext["has"], attr: ElementContext["attr"]): boolean {
  for (const name of ["aria-label", "aria-labelledby"]) {
    if (!has(name)) continue;
    // `attr` answers the WRITTEN text, and `undefined` for anything it cannot read — so a computed
    // `aria-label={title}` counts, and only a literal empty string does not.
    if (attr(name) === "") continue;
    return true;
  }
  return false;
}

export const mediaWithNoCaptions = {
  id: "media-with-no-captions",

  report: {
    severity: "warn",
    reportedWhen: "a `video` or `audio` element carries no `<track>`, so nothing on the page says what is in it",
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
      "**Music counts, and the answer is not captions.** Its content really is the sound — that is\n" +
      "the point of it — but somebody who cannot hear it still has to be told what it is. A song\n" +
      'with words carries them as `kind="descriptions"`, and one without needs a label beside the\n' +
      "player rather than a track: the title, the performer, the length. What is being asked for is\n" +
      "not a transcript of every sound, it is that the page not be silent ABOUT the sound.\n\n" +
      "A `<video muted>` is NOT reported — there is no sound to caption, which is the decorative\n" +
      "background loop and not this fault.\n\n" +
      "A label is taken as the answer, which is what music needs: an `aria-label` or an\n" +
      "`aria-labelledby` on the element silences this. An empty one does not — that is a label\n" +
      "written and nothing said.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag, has, truth, attr, children, resolve }) {
    if (tag !== "video" && tag !== "audio") return [];

    /**
     * No sound, nothing to caption. The decorative background loop, which would otherwise be the
     * commonest false report this rule could make.
     *
     * `muted={false}` is the one spelling that has to come back through: it is the attribute
     * WRITTEN and the claim being the opposite one, so silencing on its presence alone silenced a
     * `<video>` whose source says out loud that it has sound. Anything unreadable —
     * `muted={quiet}` — still counts, which is the direction that cannot report working markup.
     */
    if (tag === "video" && has("muted") && truth("muted") !== false) return [];

    /**
     * A LABEL is the other answer, and this rule asked for it before it accepted it.
     *
     * Its own advice says so: "a song without words needs a label beside the player rather than a
     * track: the title, the performer, the length. What is being asked for is not a transcript of
     * every sound, it is that the page not be silent ABOUT the sound." A `<track>` for an
     * instrumental is close to meaningless, so the advice was right — and the code went on
     * demanding the track anyway, which made the rule inconsistent with itself. Measured on
     * `<audio src="/song.mp3" controls aria-label="Chopin, Nocturne op. 9 no. 2, 4:33" />`: still
     * reported, with advice telling the author to do what they had already done.
     *
     * So a label silences it. It is a weaker alternative than captions and it is not pretending
     * otherwise — what it buys is that somebody who cannot hear the player still knows what it is
     * playing, which for music is the whole of what there is to say.
     *
     * `aria-labelledby` counts for the same reason, and an EMPTY label does not: `aria-label=""` is
     * the attribute written and nothing said, which is the shape the muted check above is careful
     * about too. An unreadable one — `aria-label={title}` — counts, because the direction this rule
     * errs in is silence rather than a false report about working markup.
     */
    if (labelled(has, attr)) return [];

    if (hasATrackOrCannotTell(children, resolve)) return [];

    return [{ tag, ...positionOf(openingOf(element as JsxElementLike)) }];
  },
} as const satisfies ElementRule<MediaWithNoCaptionsIssue>;
