import { GLOBAL_RUNTIME, COMPONENT_RUNTIME } from "../core/runtime";
import { attach, detach } from "../helpers/constants";
import type { BaseComponent } from "../types/vdom";
import type { State } from "./State";
import { reactivityScope } from "./tracker";

export interface Effect {
  id: number;
  effect: () => undefined | (() => void);
  deps: Set<State<any>>;
  shouldRebuild: boolean;
  cleanup: (() => void) | null;
  alwaysRebuild: boolean;
  mutated: Set<State<unknown>>;
}

export function runComponentEffects(component: BaseComponent<any>) {
  // Effects are client-only — never run them during a server render. Read off
  // the component, not the module-level env: this also runs from the task queue,
  // long after the server render has yielded and reset that.
  if (component[COMPONENT_RUNTIME].env === "server") return;

  const effects = component[GLOBAL_RUNTIME].effects;
  if (!effects) return;

  const dirtyEffects: Effect[] = [];
  for (const eff of effects) {
    if (eff.shouldRebuild) {
      eff.cleanup?.();
      eff.cleanup = null;
      dirtyEffects.push(eff);
    }
  }

  for (const eff of dirtyEffects) {
    for (const dep of eff.deps) {
      dep[detach](eff.id);
    }

    // Postavljamo globalni kontekst na trenutni efekat
    reactivityScope.currentEffect = eff;
    eff.deps.clear();
    eff.mutated.clear();

    const res = eff.effect();

    // Clear the context once the effect has run, so a signal read afterwards
    // is not recorded as one of its dependencies.
    reactivityScope.currentEffect = null;

    if (typeof res === "function") {
      eff.cleanup = res;
    }

    for (const mutatedDep of eff.mutated) {
      mutatedDep[detach](eff.id);
      eff.deps.delete(mutatedDep);
    }

    for (const dep of eff.deps) {
      dep[attach]({
        id: eff.id,
        onChange: () => {
          eff.shouldRebuild = true;
        },
      });
    }

    eff.shouldRebuild = eff.alwaysRebuild;
  }
}
