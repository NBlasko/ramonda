import { describe, expect, test } from "vitest";
import { ADD_ON_INFO, ADD_ONS, FLAGS, HELP, addOnOptions, readArgs } from "../args";

/**
 * Each add-on is described once, and every place that names one reads that description.
 *
 * They were four lists — `--help`, the multi-select's hints, the generated README and the package's
 * own README — each typed beside the code it served. The agent that found the scaffolder's gaps found
 * exactly that shape on the docs side: two hand-kept lists of the same choices, already apart.
 */
describe("one description per add-on", () => {
  test("`--help` prints each add-on's own line", () => {
    for (const addon of ADD_ONS) expect(HELP).toContain(`${ADD_ON_INFO[addon].adds} — ${ADD_ON_INFO[addon].hint}`);
  });

  test("the multi-select offers each with the same hint, and no router with ssr", () => {
    const spa = addOnOptions("spa");
    expect(spa.map((one) => one.value)).toEqual([...ADD_ONS]);
    for (const one of spa) expect(one.hint).toBe(`${ADD_ON_INFO[one.value].adds} — ${ADD_ON_INFO[one.value].hint}`);
    expect(addOnOptions("ssr").map((one) => one.value)).not.toContain("router");
  });
});

describe("a near miss is named", () => {
  const message = (...argv: string[]) => {
    const parsed = readArgs(argv);
    return parsed.kind === "error" ? parsed.message : "";
  };

  test("an add-on one letter off", () => {
    expect(message("--add", "css,quey")).toContain('Did you mean "query"?');
  });

  test("a mode one letter off", () => {
    expect(message("--mode", "spaa")).toContain('Did you mean "spa"?');
  });

  test("a flag one letter off", () => {
    expect(message("--mood", "ssr")).toContain("Did you mean --mode?");
  });

  test("and nothing is suggested for a word near nothing", () => {
    expect(message("--add", "kubernetes")).not.toContain("Did you mean");
    expect(message("--frobnicate")).not.toContain("Did you mean");
  });
});

/** Found in review of this branch — each a flag that did something other than it said, silently. */
describe("a flag that says nothing is refused", () => {
  const parse = (...argv: string[]) => readArgs(argv);
  const message = (...argv: string[]) => {
    const parsed = parse(...argv);
    return parsed.kind === "error" ? parsed.message : "";
  };

  test("case does not matter, for --mode as for --add", () => {
    const parsed = parse("--mode", "SSR", "--add", "CSS");
    expect(parsed.kind === "answers" && parsed.answers.mode).toBe("ssr");
    expect(parsed.kind === "answers" && parsed.answers.addons).toEqual(["css"]);
    expect(message("--Mode")).toContain("Did you mean --mode?");
  });

  test("an empty --add is not none", () => {
    expect(message("--add", "")).toContain("--add");
    expect(message("--add", ",")).toContain("--add");
  });

  test("none beside an add-on is a contradiction", () => {
    expect(message("--add", "none,css")).toContain("none");
  });

  test("an add-on named twice is chosen once", () => {
    const parsed = parse("--add", "css,css,query");
    expect(parsed.kind === "answers" && parsed.answers.addons).toEqual(["css", "query"]);
  });

  test("only git and install have a --no- form", () => {
    for (const flag of ["--no-help", "--no-yes", "--no-overwrite", "--no-version"])
      expect(message(flag), flag).toContain(flag);
    expect(parse("--no-git", "--no-install").kind).toBe("answers");
  });

  test("every option the parser takes is in --help, and is a suggestion", () => {
    for (const flag of FLAGS) expect(HELP).toContain(flag);
    expect(FLAGS).toEqual(
      expect.arrayContaining(["--mode", "--add", "--git", "--no-git", "--install", "--no-install"]),
    );
  });
});
