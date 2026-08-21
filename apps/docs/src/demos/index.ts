import type { ComponentClassKind } from "@ramonda/core";
import { ComputeDemo } from "./ComputeDemo";
import { Counter } from "./Counter";
import { ListDemo } from "./ListDemo";
import { FilteredList } from "./FilteredList";
import { FormDemo } from "./FormDemo";
import { InheritanceDemo } from "./InheritanceDemo";
import { LazyPanel } from "./LazyPanel";
import { LensSharing } from "./LensSharing";
import { EffectCleanup } from "./EffectCleanup";
import { ErrorBoundaryDemo } from "./ErrorBoundaryDemo";
import { IntervalClock } from "./IntervalClock";
import { HostTag } from "./HostTag";
import { KeyboardShortcut } from "./KeyboardShortcut";
import { LifecycleLog } from "./LifecycleLog";
import { MemoHandlers } from "./MemoHandlers";
import { MutationDemo } from "./MutationDemo";
import { QueryDemo } from "./QueryDemo";
import { PersistDemo } from "./PersistDemo";
import { RefFocus } from "./RefFocus";
import { RouteInfo } from "./RouteInfo";
import { StoreSubscription } from "./StoreSubscription";
import { ThemeContextDemo } from "./ThemeContextDemo";
import { TimeoutReveal } from "./TimeoutReveal";
import { TimerOnClick } from "./TimerOnClick";
import { WatchPropDemo } from "./WatchPropDemo";
import { WindowSize } from "./WindowSize";

/**
 * Every component a ```demo: fence can name.
 *
 * A registry rather than a dynamic import, on purpose: a page that references a
 * demo which does not exist must fail loudly, not leave a blank space on a live
 * page. `Markdown.tsx` throws on a miss.
 *
 * The key is also the FILENAME, because `scripts/build-content.mjs` reads the
 * same directory to generate the source shown beside each example. One
 * definition, rendered live and printed verbatim — they cannot drift.
 */
export const demos: Record<string, ComponentClassKind> = {
  Counter,
  ComputeDemo,
  LifecycleLog,
  HostTag,
  RefFocus,
  WindowSize,
  KeyboardShortcut,
  TimeoutReveal,
  TimerOnClick,
  IntervalClock,
  EffectCleanup,
  WatchPropDemo,
  ThemeContextDemo,
  MemoHandlers,
  StoreSubscription,
  ErrorBoundaryDemo,
  PersistDemo,
  ListDemo,
  FilteredList,
  LensSharing,
  RouteInfo,
  QueryDemo,
  MutationDemo,
  InheritanceDemo,
  LazyPanel,
  FormDemo,
};

/** What each demo is for, shown on the examples page. */
export const demoTitles: Record<string, string> = {
  Counter: "State and a handler",
  ComputeDemo: "@compute — derived values, cached",
  LifecycleLog: "@created, @mounted, @destroyed — in order",
  HostTag: "@Host — the element a component is",
  RefFocus: "Refs — reaching the element",
  WindowSize: "@onWindow — a global listener",
  KeyboardShortcut: "@onDocument — a keyboard shortcut",
  TimeoutReveal: "@timeout — cancelled on unmount",
  TimerOnClick: "Timeout — started by a click, cleared by teardown",
  IntervalClock: "@interval — and the two-pass pattern",
  EffectCleanup: "Cleanup — what a subscription returns",
  WatchPropDemo: "@watchProp — reacting to a prop",
  ThemeContextDemo: "Context — a value without threading",
  MemoHandlers: "@memoized — stable handler identity",
  StoreSubscription: "createSubscriptionDecorator — external stores",
  ErrorBoundaryDemo: "ErrorBoundary — containing a failure",
  PersistDemo: "@persist — a value from the server",
  ListDemo: "list() — lists without keys",
  FilteredList: "list() — a filtered, conditional list",
  LensSharing: "focusOn — what an immutable edit copies",
  QueryDemo: "Query — one request per key, cached",
  MutationDemo: "Mutation — optimistic, with rollback",
  RouteInfo: "Navigator — the live route of this site",
  InheritanceDemo: "Inheritance — the unit of reuse",
  LazyPanel: "AsyncLoad — a component in its own chunk",
  FormDemo: "Form — fields, validation and array rows",
};
