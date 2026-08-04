import type { BaseComponent } from "../types/vdom";
import { diagnose } from "./diagnostics";
import { stateProperty } from "./stateLabels";

/**
 * Reports a write to a hook's own props. The write itself is stopped by the
 * proxy, which throws; this only supplies the explanation and the devtools entry.
 */
export function reportHookPropWrite(hook: object, property: string): void {
  const name = hook.constructor.name;
  diagnose("RMD015", `${name}:${property}`, `<${name} /> assigned to \`props.${property}\`.`);
}

/**
 * The component currently inside render(), or undefined outside a render.
 * DEV-only: written by generateRenderOutput, read by State.set so a write that
 * happens while rendering can be traced back to the component doing it.
 *
 * Renders never nest — a render() returns a vnode tree and its children are
 * rendered later, from the diff — so a single slot is enough.
 */
export const renderPhase: { component: BaseComponent | undefined } = {
  component: undefined,
};

/** Reports a write to a component's own props, which is always a no-op. */
export function reportPropWrite(component: BaseComponent, property: string): void {
  const name = component.constructor.name;
  diagnose("RMD004", `${name}:${property}`, `<${name} /> assigned to \`props.${property}\`.`);
}

/**
 * Reports a state write that landed while a component was rendering. Takes the
 * signal rather than its name so the name lookup only happens when reporting —
 * this runs on every state change.
 */
export function reportWriteDuringRender(signal: object): void {
  const component = renderPhase.component;
  if (!component) return;

  const name = component.constructor.name;
  const target = stateProperty(signal) ?? "a signal";

  diagnose("RMD001", `${name}:${target}`, `<${name} /> wrote to \`${target}\` while its render() was running.`);
}

/**
 * The instance whose `[INSPECT]()` is running, or undefined outside one.
 *
 * DEV-only: written by `readDetail` in `debug/inspector.ts` around the call, read by `State.set` so
 * a write made while DESCRIBING an instance can be named.
 *
 * A single slot. `[INSPECT]()` is called once per instance by a walk that visits each of them in
 * turn, so two cannot be running at the same time — and if one called another's, the innermost is
 * the one doing the write, which is what this holds.
 */
export const inspectPhase: { instance: object | undefined } = {
  instance: undefined,
};

/**
 * Reports a state write made from inside `[INSPECT]()`.
 *
 * The panel calls that method on every commit while it is open on the components tab, so a write
 * there closes a circle: the write schedules a render, the render commits, the commit pings the
 * panel, and the panel asks again. The app then changes under the person debugging it — and the
 * values on screen are not the values the app had a moment ago, which is a wrong answer handed to
 * the one reader least able to doubt it.
 *
 * Reported BEFORE `shouldUpdate`, like the `@compute` case and for the same reason: describing is
 * meant to be a pure read, so a write that happens to change nothing is still the mistake. The
 * render-time check (RMD001) is the one that waits, because there a no-op write schedules nothing.
 */
export function reportWriteDuringInspect(signal: object): void {
  const instance = inspectPhase.instance;
  if (!instance) return;

  const name = instance.constructor.name;
  const target = stateProperty(signal) ?? "a signal";

  diagnose(
    "RMD030",
    `${name}:${target}`,
    `<${name} /> wrote to \`${target}\` from inside its \`[INSPECT]()\`.`,
  );
}

/**
 * The @compute currently evaluating its body, as `Owner.name`, or undefined
 * outside one. DEV-only: written by the compute decorator around the getter
 * call, read by State.set so a write made while deriving can be named.
 *
 * A single slot even though computes nest: an inner @compute reading is on the
 * stack above the outer one, so whichever is innermost is the one actually doing
 * the write, and that is the one this holds. The decorator saves and restores
 * the previous label, so unwinding a nested read lands back on the outer one.
 */
export const computePhase: { label: string | undefined } = {
  label: undefined,
};

/**
 * Reports a state write that landed while a @compute was deriving its value.
 * Fires for ANY write, not only one that changes the value: unlike a no-op write
 * in render(), a write inside a compute is never intended — the getter is meant
 * to be pure — so the earliest possible report is the useful one.
 */
export function reportWriteDuringCompute(signal: object): void {
  const label = computePhase.label;
  if (!label) return;

  const target = stateProperty(signal) ?? "a signal";

  diagnose("RMD018", `${label}:${target}`, `\`${label}\` (a @compute) wrote to \`${target}\` while it was computing.`);
}
