import { Sheet, transform } from "@ramonda/css/compiler";

/** The example run through `transform` and the `Sheet`, as a page shows it. */
export function compiledExample(source, where) {
  let result;
  try {
    result = transform(source, { filename: "example.tsx" });
  } catch (error) {
    throw new Error(`[docs] ${where}: a \`compiled\` example does not compile — ${error.message}`);
  }
  if (result === undefined || result.blocks.length === 0) {
    throw new Error(`[docs] ${where}: a \`compiled\` example holds no style block to show the output of.`);
  }
  const sheet = new Sheet();
  sheet.add("example.tsx", result.blocks);
  // One class to a line: the list is long, and a reader scans it rather than scrolling along it.
  const classes = [...result.code.matchAll(/"(r-[^"]+)"/g)].flatMap((one) => one[1].split(" ")).join("\n");
  return { classes, css: sheet.cssFor("example.tsx").trim() };
}
