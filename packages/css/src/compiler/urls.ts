import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

/**
 * What `url-not-found` asks the disk, for one source file — handed to `checkBlock` by the build and by
 * the editor, so the rule itself stays a function of the block and nothing else.
 *
 * Only for a file that is really on disk: a test or a tool that names a file it never wrote (`C.tsx`)
 * has no folder to look in, and a relative path there is not this rule's to judge.
 */
export function urlCheckFor(
  fileName: string | undefined,
): { readonly fileName: string; readonly urlExists: (relative: string) => boolean } | undefined {
  if (fileName === undefined || !isAbsolute(fileName) || !existsSync(dirname(fileName))) return undefined;
  const folder = dirname(fileName);
  return { fileName: basename(fileName), urlExists: (relative) => existsSync(resolve(folder, relative)) };
}
