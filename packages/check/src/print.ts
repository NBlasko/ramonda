import { writeSync } from "node:fs";

/**
 * Writes all of `text` to stdout before returning — for output a program reads, which the command
 * then exits after.
 *
 * `process.stdout.write` to a PIPE is asynchronous, and `process.exit` does not wait for it: measured,
 * a page past 64 KB came back cut through a pipe, and a `--json` object with enough findings would be
 * half a line `JSON.parse` cannot read. A pipe takes what it has room for and answers with how much, so
 * the loop is what finishes the write. `EAGAIN` is a full pipe on a non-blocking stdout: wait, and try
 * again. `EPIPE` is a reader that stopped early. Found by review; `ramonda-css` met the first of these on
 * a formatter's output. Copied in `check-bundle.mjs` and in `@ramonda/css`, which cannot import this.
 */
export function printWhole(text: string): void {
  const bytes = Buffer.from(text, "utf8");
  for (let written = 0; written < bytes.length; ) {
    try {
      written += writeSync(1, bytes, written, bytes.length - written);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // The reader closed the pipe — `| head` — which is its choice, not a fault to report.
      if (code === "EPIPE") return;
      if (code !== "EAGAIN") throw error;
      // A full pipe: wait a millisecond for the reader rather than spin a core on it.
      Atomics.wait(PAUSE, 0, 0, 1);
    }
  }
}

const PAUSE = new Int32Array(new SharedArrayBuffer(4));
