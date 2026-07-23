import { renderPage, renderDocument } from "@ramonda/core";
import { routePaths } from "@ramonda/router";
import { App } from "./App";
import { routes } from "./routes";

/**
 * Everything the prerender script needs, and nothing about the filesystem.
 *
 * The loop lives here rather than in the script because this is the side that
 * has the app: the script's job is to install a DOM and write files, and keeping
 * those two apart is what makes the pipeline testable without touching a disk.
 */
export function paths(): readonly string[] {
  const { paths, needsData } = routePaths(routes);
  if (needsData.length > 0) {
    // Every docs route is literal. If one ever is not, the build must say so
    // rather than quietly ship a site missing those pages.
    throw new Error(`[docs] These routes need concrete paths and none were supplied: ${needsData.join(", ")}`);
  }
  return paths;
}

export async function renderOne(path: string): Promise<string> {
  window.history.pushState(null, "", path);
  const page = await renderPage(<App />);
  return renderDocument(page, {
    lang: "en",
    styles: ["/assets/site.css"],
    scripts: ["/assets/client.js"],
    rootId: "app",
  });
}
