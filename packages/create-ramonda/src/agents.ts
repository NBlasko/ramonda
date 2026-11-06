import type { AddOn, Mode } from "./args";

/**
 * What a coding agent reads before it touches the project: `AGENTS.md`.
 *
 * Found by an agent that built a whole app from the docs alone. It learned the framework from its
 * feedback loop, and the loop had to be discovered: which command proves a change, what a code like
 * `RMD020` is and where it is explained, and the handful of rules every newcomer breaks first,
 * because the habit from other libraries is the opposite. Each of those cost it a round trip that
 * one page in the project would have saved.
 *
 * What it says is checked, not just written: every link in it must be a page the docs have and every
 * code a section of the diagnostics page (`scaffold.test.ts`), and the command it names is built from
 * the same list as the `check` script, so the two cannot describe different things.
 */

/** One step of `npm run check`: the command, and the words `AGENTS.md` uses for it. */
export interface CheckStep {
  run: string;
  says: string;
}

/** What `npm run check` runs, in order. `build` is last and always there. */
export function checkSteps(addons: readonly AddOn[]): CheckStep[] {
  const steps: CheckStep[] = [];
  if (addons.includes("biome")) {
    steps.push({ run: "npm run lint", says: "lint" });
    steps.push({ run: "npm run format:check", says: "the format check" });
  }
  if (addons.includes("testing")) steps.push({ run: "npm test", says: "the tests" });
  steps.push({
    run: "npm run build",
    says: "the build, which runs `ramonda-check`, the type check and the production build, then `ramonda-check-bundle` over what it emitted",
  });
  return steps;
}

const DOCS = "https://ramonda.dev";

/** `AGENTS.md` for a project with this mode and these add-ons. */
export function agentsFile(mode: Mode, addons: readonly AddOn[]): string {
  const has = (addon: AddOn) => addons.includes(addon);
  const steps = checkSteps(addons).map((step) => step.says);
  const runs = steps.length === 1 ? steps[0] : `${steps.slice(0, -1).join(", ")}, then ${steps.at(-1)}`;

  const codes = [
    "A message from Ramonda starts with a code, and its prefix names the package: `RMD` is core, `RMQ` query, `RMF` form, `RML` lens. Every code has a page of its own, the code in lower case, that says what causes it and what to write instead:",
    "",
    `    ${DOCS}/reference/diagnostics/rmd020`,
    "",
    `- A \`ramonda-check\` finding names a rule. The rules are on ${DOCS}/reference/check.`,
  ];
  if (has("css")) {
    codes.push(
      `- A \`ramonda-css\` finding names a rule as well. \`npx ramonda-css explain <property>\` says what the config allows for one property, and which line decided it.`,
    );
  }
  codes.push(
    has("testing")
      ? '- In development a diagnostic prints in the browser console. In a test it fails that test; `allowDiagnostics("RMD020")` inside the test lets one code through when the test means to cause it.'
      : "- In development a diagnostic prints in the browser console, so open the console after a change.",
    `- Something looks wrong and nothing printed a code: ${DOCS}/symptoms lists what you can see and where each leads.`,
  );

  const rules = [
    `Event names are the DOM's, in lower case: \`onclick\`, \`oninput\`. (${DOCS}/concepts/events)`,
    "Hand over a method, not a function built in the markup: `onclick={this.save}`, not `onclick={() => this.save()}`. Methods are bound. A handler built per item takes `@memoized`. (`RMD020`)",
    "A hook's props callback does not rebuild a value whose contents stay the same. An object or array built there anew on every run is a changed prop each time: keep it in a `@compute`, a field or a module constant. A function there is a method: `fetch: self.load`. (`RMD022`)",
    `Anything \`render()\` shows that can change is \`@state\`, or a \`@compute\` over state. A plain field does not re-render. (${DOCS}/concepts/state)`,
    "Hooks are built in the order their fields are declared. Declare a hook below every field its callback reads, and a context consumer below the provider on the same component. (`RMD057`)",
    `A row of \`list()\` is identified by its object. Data that arrives as new objects, a refetch for one, needs a \`key\` from the data, never the array index. (${DOCS}/lists)`,
    "Code for development only goes inside `if (import.meta.env.DEV)`, so a production build leaves it out.",
  ];
  if (has("form")) {
    rules.push(
      `A choice is \`<Select>\` and a long text \`<TextArea>\`; the plain \`<select>\` and \`<textarea>\` are refused. (${DOCS}/forms/fields)`,
    );
  }
  if (mode === "ssr") {
    rules.push(
      `Every route in \`src/entry-server.tsx\` says how it renders, and \`{}\` means on every request. A page that is the same for everyone is \`prerender: true\`; a route renders per request only when it reads the request. The build refuses to bake a page that reads it. (${DOCS}/ssr/modes)`,
    );
  }

  return [
    "# For coding agents",
    "",
    "This is a Ramonda app. Components are classes, and much of what other UI libraries teach is refused or reported here. When a message links a page, read it before changing course.",
    "",
    "## Before a change is done",
    "",
    `Run \`npm run check\`. It runs ${runs}. A change is done when it passes.`,
    "",
    "## Diagnostics are codes",
    "",
    ...codes,
    "",
    "## Rules that are easy to break",
    "",
    ...rules.map((rule, index) => `${index + 1}. ${rule}`),
    "",
    "## The docs",
    "",
    `${DOCS} describes the latest release. ${DOCS}/reference lists every page, so start a new subject there.`,
    "",
  ].join("\n");
}

/** `CLAUDE.md`: one line, because that tool reads its own file name and not `AGENTS.md`. */
export const CLAUDE_FILE = "@AGENTS.md\n";
