import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "media", "tsconfig.json"));

describe("accessKey", () => {
  /**
   * The character is not the page's to give: the browser has bindings for most letters and so does
   * every screen reader — the software of the people most likely to be using shortcuts at all.
   */
  test("every element claiming a shortcut is reported, with the character when it is readable", () => {
    const found = run().findings["access-key"];
    expect(found.map((issue) => `${issue.tag}:${issue.claimed}`)).toEqual(["button:s", "div:x"]);
  });
});

describe("media with no captions", () => {
  test("a video and an audio with nothing to read are reported", () => {
    const found = run().findings["media-with-no-captions"];
    expect(found.map((issue) => issue.tag)).toEqual(["video", "audio", "video"]);
  });

  /** `captions`, `subtitles` and a `kind`-less track all carry the words; `chapters` does not. */
  test("a track that carries the words silences it, and one that does not carry them does not", () => {
    const found = run().findings["media-with-no-captions"];
    // Seven media elements in the fixture; three are reported, and the third is the `chapters` one.
    expect(found).toHaveLength(3);
  });

  /**
   * `<video muted>` has no sound to caption. It is the decorative background loop, the commonest
   * `<video>` on a page that has one, and would otherwise be the commonest false report here.
   */
  test("a muted video is not reported", () => {
    const found = run().findings["media-with-no-captions"];
    expect(found).toHaveLength(3);
  });
});

/**
 * The last two rules on the list, and the last two shapes nobody had planted.
 *
 * Both gaps are about an attribute whose PRESENCE was read as its meaning — and in both cases the
 * source says the opposite out loud.
 */
describe("what an attribute says, not that it is there", () => {
  const found = () => analyzeProject(join(here, "fixtures", "media-and-placeholder", "tsconfig.json")).findings;
  const lines = (id: string) => (found()[id] ?? []).map((issue) => issue.line).sort((a, b) => a - b);

  /**
   * `muted={false}` is a `<video>` saying out loud that it has sound.
   *
   * The rule went quiet on the attribute being WRITTEN, which is right for `muted` and for
   * `muted={quiet}` — anything unreadable has to stay quiet, that being the direction that cannot
   * report working markup. It is wrong for the one spelling that settles the question the other
   * way. 9 is the plain case, 12 is `muted`, 15 is `muted={false}`, 18 has its track in a fragment.
   */
  test("a `<video muted={false}>` has sound, and is reported", () => {
    expect(lines("media-with-no-captions")).toEqual([8, 14]);
  });

  /**
   * `placeholder=""` names nothing, and reading its presence as a name put the report on the WRONG
   * RULE.
   *
   * `named-only-by-a-placeholder` told the author their placeholder is the only name this control
   * has — on a control with no name at all — while `control-with-no-label`, whose sentence that is,
   * stayed quiet because a placeholder was written. Line 27 is now the second rule's, which is not
   * a silence but a correction: the fault was always there and the wrong rule was describing it.
   */
  test("an empty placeholder moves the report to the rule whose sentence it is", () => {
    expect(lines("named-only-by-a-placeholder")).toEqual([24]);
    expect(lines("control-with-no-label")).toEqual([27]);
  });

  test("and a properly labelled control is nobody's report, placeholder or not", () => {
    // 31 carries a `+381…` hint beside a real `<label htmlFor>`, which is what a placeholder is for.
    expect(lines("named-only-by-a-placeholder")).not.toContain(31);
    expect(lines("control-with-no-label")).not.toContain(31);
  });
});
