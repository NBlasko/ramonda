import { writeSync } from "node:fs";

/**
 * Writes all of `text` to stdout before returning — for output a program reads, which the command
 * then exits after.
 *
 * `process.stdout.write` to a PIPE is asynchronous, and `process.exit` does not wait for it: measured,
 * a page past 64 KB came back cut through a pipe, and a `--json` object with enough findings would be
 * half a line `JSON.parse` cannot read. A pipe takes what it has room for and answers with how much, so
 * the loop is what finishes the write. `EAGAIN` is a full pipe on a non-blocking stdout: try again.
 * Found by review; `ramonda-css` met it first, on a formatter's output.
 */
export function printWhole(text: string): void {
  const bytes = Buffer.from(text, "utf8");
  for (let written = 0; written < bytes.length; ) {
    try {
      written += writeSync(1, bytes, written, bytes.length - written);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
    }
  }
}
