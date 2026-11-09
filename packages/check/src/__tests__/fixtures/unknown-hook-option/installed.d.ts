import { Hook } from "@ramonda/core";

/** A hook reached through a DECLARATION FILE, as every installed package's is. */
export declare class Fetching<T> extends Hook<{
  key: string[];
  fetch: () => Promise<T>;
  staleTime?: number;
  enabled?: boolean;
}> {}
