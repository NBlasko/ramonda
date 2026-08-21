import { Maps } from "./kinds";

function makeCache(): Maps<string, number> {
  return new Maps<string, number>();
}

/** Two names on the way to the `Map`: this one, and the one that builds it. */
export function wrap(): { cache: Maps<string, number> } {
  return { cache: makeCache() };
}
