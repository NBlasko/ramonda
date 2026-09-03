import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
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
    expect(found.map((issue) => issue.tag)).toEqual(["video", "audio", "audio", "video", "video"]);
  });

  /** `captions`, `subtitles` and a `kind`-less track all carry the words; `chapters` does not. */
  test("a track that carries the words silences it, and one that does not carry them does not", () => {
    const found = run().findings["media-with-no-captions"];
    // Sixteen media elements in the fixture; five are reported.
    expect(found).toHaveLength(5);
  });

  /**
   * A LABEL is the other answer, and the rule asked for it in its advice before it accepted it in
   * its code.
   *
   * For music a `<track>` is close to meaningless — a caption file for an instrumental says nothing
   * — while a label says the one thing there is to say: what the player is playing. Measured before
   * this existed, on `<audio src="/song.mp3" controls aria-label="Chopin, Nocturne op. 9 no. 2,
   * 4:33" />`: reported, with advice telling the author to do what they had already done.
   *
   * An EMPTY label is still reported, because that is a label written and nothing said — the same
   * care the `muted` escape takes about `muted={false}`.
   */
  test("a label silences it, and an empty one does not", () => {
    const found = run().findings["media-with-no-captions"];
    const lines = found.map((issue) => issue.line);

    const lineOf2 = lineOf();
    // Three spellings of a label, and a labelled <video> for the same argument.
    expect(lines).not.toContain(lineOf2('aria-label="Chopin'));
    expect(lines).not.toContain(lineOf2('aria-labelledby="now-playing"'));
    // A name computed at runtime is a name: `attr` cannot read it, and the direction this rule errs
    // in is silence rather than a false report about working markup.
    expect(lines).not.toContain(lineOf2("aria-label={rest.title"));
    expect(lines).not.toContain(lineOf2('aria-label="Rotating logo'));

    expect(lines).toContain(lineOf2('aria-label=""'));
  });

  /**
   * A `kind` held in a NAME is the same claim as one written out.
   *
   * This file used to walk the track's attributes itself and accept only a literal, so
   * `<track kind={CHAPTERS}>` with `const CHAPTERS = "chapters"` counted as a usable track and
   * silenced the report — while the identical `kind="chapters"` above it was reported. It reads the
   * child through `contextFor` now, which follows a name to the value it holds.
   */
  test("a `kind` one name away is read, and the usable one still silences it", () => {
    const lines = (run().findings["media-with-no-captions"] ?? []).map((issue) => issue.line);
    const at = lineOf();

    // Written as a search rather than a number: three tests here used literal line numbers, and
    // inserting six elements into the fixture moved every one of them. What the test is about is
    // the ELEMENT, and the element can be found.
    expect(lines).toContain(at("kind={CHAPTERS}"));
    expect(lines, "`captions` one name away still carries the words").not.toContain(at("kind={CAPTIONS}"));
    expect(lines, "a spread may carry or replace the `kind`, so this one cannot be judged").not.toContain(
      at("{...rest}"),
    );
  });

  /**
   * `<video muted>` has no sound to caption. It is the decorative background loop, the commonest
   * `<video>` on a page that has one, and would otherwise be the commonest false report here.
   */
  test("a muted video is not reported", () => {
    const lines = run().findings["media-with-no-captions"].map((issue) => issue.line);
    expect(lines).not.toContain(lineOf()("muted"));
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
    // 17 is `muted="false"`, which is MUTED: a boolean attribute is on whenever it is present, so
    // there is no sound to caption. Read as a VALUE this was a report against correct markup.
    expect(lines("media-with-no-captions")).not.toContain(17);
  });

  /**
   * `placeholder=""` names nothing, and reading its presence as a name put the report on the WRONG
   * RULE.
   *
   * `named-only-by-a-placeholder` told the author their placeholder is the only name this control
   * has — on a control with no name at all — while `control-with-no-label`, whose sentence that is,
   * stayed quiet because a placeholder was written. Line 30 is now the second rule's, which is not
   * a silence but a correction: the fault was always there and the wrong rule was describing it.
   */
  test("an empty placeholder moves the report to the rule whose sentence it is", () => {
    expect(lines("named-only-by-a-placeholder")).toEqual([27]);
    expect(lines("control-with-no-label")).toEqual([30]);
  });

  test("and a properly labelled control is nobody's report, placeholder or not", () => {
    // 34 carries a `+381…` hint beside a real `<label htmlFor>`, which is what a placeholder is for.
    expect(lines("named-only-by-a-placeholder")).not.toContain(34);
    expect(lines("control-with-no-label")).not.toContain(34);
  });
});

/**
 * The line the ELEMENT is written on, found by any text inside it.
 *
 * Three tests here named a literal line number, and inserting six elements into the fixture moved
 * all three — a failure that says nothing about the rule.
 *
 * It walks BACK to the opening tag, because that is what the rule reports: a `kind={CHAPTERS}` sits
 * on the `<track>` a line below the `<video>` that carries it, and searching for the needle alone
 * answered 57 for a finding at 56. Both floors matter — a needle that matched nothing would answer
 * 0, and one with no element above it would answer whatever came first in the file.
 */
function lineOf(): (needle: string) => number {
  const source = readFileSync(join(here, "fixtures", "media", "app.tsx"), "utf8").split("\n");
  return (needle: string) => {
    const at = source.findIndex((line) => line.includes(needle));
    if (at === -1) throw new Error(`[media] no line contains ${needle} — the fixture moved out from under this test`);

    for (let back = at; back >= 0; back--) {
      if (/<(video|audio)\b/.test(source[back] ?? "")) return back + 1;
    }
    throw new Error(`[media] ${needle} has no <video> or <audio> above it`);
  };
}
