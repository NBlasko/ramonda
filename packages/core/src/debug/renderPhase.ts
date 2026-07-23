import type { BaseComponent } from "../types/vdom";
import { diagnose } from "./diagnostics";
import { stateProperty } from "./stateLabels";

/**
 * Reports a write to a hook's own options. The write itself is stopped by the
 * proxy, which throws; this only supplies the explanation and the devtools entry.
 */
export function reportOptionWrite(hook: object, property: string): void {
  const name = hook.constructor.name;
  diagnose("RMD015", `${name}:${property}`, `<${name} /> assigned to \`options.${property}\`.`);
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
