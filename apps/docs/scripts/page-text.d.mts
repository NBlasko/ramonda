/** Types for `page-text.mjs`, which a test imports. */
export declare const SITE: string;
export declare function textPath(path: string): string;
export declare function pageText(
  body: string,
  options: { title: string; pages: ReadonlySet<string>; where: string },
): string;
export declare function llmsIndex(
  pages: readonly { path: string; title: string; description: string; section: string }[],
  options: { name: string; summary: string; leaveOut: ReadonlySet<string> },
): string;
export declare function llmsFull(pages: readonly { path: string; text: string }[]): string;
