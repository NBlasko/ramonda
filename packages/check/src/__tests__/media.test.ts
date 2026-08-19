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
