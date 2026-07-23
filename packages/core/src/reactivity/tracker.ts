import type { Effect } from "../reactivity/effect";
import type { State } from "./State";

export const reactivityScope: {
  currentEffect: Effect | null;
} = {
  currentEffect: null,
};

export const trackerContainer: {
  current: { addDep: (s: State<any>) => void } | null;
} = {
  current: null,
};
