import ts from "typescript";
import { memberName, positionOf } from "../syntax";
import { importedFromCore } from "./core-import";
import { narrowedTo } from "./side-guard";
import { clientOnlyBecause } from "./lifecycle-env";
import type { Rule, RuleContext } from "./rule";

/**
 * A `requestContext()` read on a path that runs ONLY in the browser, for a value the browser never
 * has.
 *
 * ## Why this is provable rather than a suspicion
 *
 * The client's request scope is built by `installClientRequestScope` and carries exactly three
 * things: the live `url`, an EMPTY cookie map, and empty headers, plus the values whose keys opted
 * into `exposeToClient` and which the server actually seeded. So on the client:
 *
 * - `cookies.get(…)` and `cookies.has(…)` are empty **always**. A cookie is the server's, and an
 *   httpOnly one is invisible to JavaScript in any case, so nothing can ever expose it.
 * - `headers` is empty **always**, for the same reason.
 * - `get(key)` is empty unless the key was declared `{ exposeToClient: true }`.
 * - `url` is live and correct, and is never reported here.
 *
 * A read of the first three from a member that cannot run on the server is therefore certain to find
 * nothing, before the app is ever opened. That is the whole claim, and it is why this rule is not
 * guessing: it is not asking whether a value will be there, it is naming a value that cannot be.
 *
 * ## What the build does not say
 *
 * Measured 2026-08-17: a component reading a key in a handler bakes cleanly under a static build —
 * `html` present, no `blockedBy` — because the read never runs during the render, so the build's
 * poison (`RequestReadDuringBuild`) is never touched. The page ships, and the browser reads
 * `undefined` and reports RMD025. The build is silent although it is certain in advance.
 *
 * ## What is deliberately NOT reported
 *
 * A key that IS exposed, because whether the server seeded it is a runtime fact. A key this cannot
 * resolve to a `requestKey(…)` declaration. A read in a `shared` lifecycle — `@created` and
 * `@mounted` default to `shared`, so they run on the server too and the read is legitimate there. A
 * member that is called from anywhere other than an event handler, since one of those callers may be
 * the server.
 */
export interface ClientOnlyRequestReadIssue {
  /** The class the read is in. */
  component: string;
  /** The member holding it, as a reader would find it. */
  member: string;
  /** What was written — `requestContext().cookies.get("session")`. */
  read: string;
  /** Why the value can never be there, in the words the report prints. */
  because: string;
  /** Why this member cannot run on the server. */
  clientOnly: string;
  file: string;
  line: number;
  column: number;
}

/**
 * Every event type the DOM's own event maps list for an element, a media element or the window.
 *
 * Generated once from `lib.dom.d.ts` — the union of `GlobalEventHandlersEventMap`,
 * `ElementEventMap`, `HTMLElementEventMap`, `HTMLMediaElementEventMap` and
 * `WindowEventHandlersEventMap` — because the question this asks is "did the reader mean an event",
 * and only a name the DOM has answers it.
 *
 * The alternative was a shape test, and it does not work: `only` and `once` begin with `on` and are
 * ordinary props, so `only={() => …}` would read as a browser-only path and report correct code.
 *
 * If it drifts behind a new DOM event, the failure is a MISS, which is the safe direction here — the
 * report is about a read that cannot work, and staying quiet about one is better than inventing one.
 */
const DOM_EVENTS: ReadonlySet<string> = new Set([
  "abort",
  "afterprint",
  "animationcancel",
  "animationend",
  "animationiteration",
  "animationstart",
  "auxclick",
  "beforeinput",
  "beforematch",
  "beforeprint",
  "beforetoggle",
  "beforeunload",
  "blur",
  "cancel",
  "canplay",
  "canplaythrough",
  "change",
  "click",
  "close",
  "compositionend",
  "compositionstart",
  "compositionupdate",
  "contextlost",
  "contextmenu",
  "contextrestored",
  "copy",
  "cuechange",
  "cut",
  "dblclick",
  "drag",
  "dragend",
  "dragenter",
  "dragleave",
  "dragover",
  "dragstart",
  "drop",
  "durationchange",
  "emptied",
  "ended",
  "error",
  "focus",
  "focusin",
  "focusout",
  "formdata",
  "fullscreenchange",
  "fullscreenerror",
  "gamepadconnected",
  "gamepaddisconnected",
  "gotpointercapture",
  "hashchange",
  "input",
  "invalid",
  "keydown",
  "keypress",
  "keyup",
  "languagechange",
  "load",
  "loadeddata",
  "loadedmetadata",
  "loadstart",
  "lostpointercapture",
  "message",
  "messageerror",
  "mousedown",
  "mouseenter",
  "mouseleave",
  "mousemove",
  "mouseout",
  "mouseover",
  "mouseup",
  "offline",
  "online",
  "pagehide",
  "pagereveal",
  "pageshow",
  "pageswap",
  "paste",
  "pause",
  "play",
  "playing",
  "pointercancel",
  "pointerdown",
  "pointerenter",
  "pointerleave",
  "pointermove",
  "pointerout",
  "pointerover",
  "pointerrawupdate",
  "pointerup",
  "popstate",
  "progress",
  "ratechange",
  "rejectionhandled",
  "reset",
  "resize",
  "scroll",
  "scrollend",
  "securitypolicyviolation",
  "seeked",
  "seeking",
  "select",
  "selectionchange",
  "selectstart",
  "slotchange",
  "stalled",
  "storage",
  "submit",
  "suspend",
  "timeupdate",
  "toggle",
  "touchcancel",
  "touchend",
  "touchmove",
  "touchstart",
  "transitioncancel",
  "transitionend",
  "transitionrun",
  "transitionstart",
  "unhandledrejection",
  "unload",
  "volumechange",
  "waiting",
  "webkitanimationend",
  "webkitanimationiteration",
  "webkitanimationstart",
  "webkittransitionend",
  "wheel",
]);

/**
 * Whether a JSX attribute name is an event handler — `onclick`, `oninput`, `on:my-event`.
 *
 * It asks for the name to be one the DOM has, and that is what keeps it from reading an ordinary
 * prop as an event. `only` and `once` start with `on` and are not handlers; a rule that treated
 * `only={() => …}` as browser-only would report correct code.
 *
 * It used to ask for a CAPITAL after `on` instead, which was right while the types spelled events
 * `on${Capitalize<name>}` and became wrong the moment they stopped: `onclick` — now the only
 * spelling — has no capital, so every handler in every project would have been missed.
 */
function isEventAttribute(name: string): boolean {
  if (name.startsWith("on:")) return name.length > 3;
  return name.startsWith("on") && DOM_EVENTS.has(name.slice(2).toLowerCase());
}

/** The JSX event attribute this node sits inside, if any — however deeply. */
function enclosingEventAttribute(node: ts.Node): string | undefined {
  for (let at: ts.Node | undefined = node; at !== undefined; at = at.parent) {
    if (!ts.isJsxAttribute(at)) continue;
    const name = ts.isIdentifier(at.name) ? at.name.text : undefined;
    return name !== undefined && isEventAttribute(name) ? name : undefined;
  }
  return undefined;
}

/**
 * Every member this class reaches ONLY from a JSX event handler.
 *
 * The provable form of "this is a handler", and the conservative direction is the point: a member is
 * counted only when it has at least one reference in an `on*` attribute and NO reference anywhere
 * else in the class. A method that is also called from `@created` has a caller that runs on the
 * server, so it is left alone — which is the difference between this rule and a guess about which
 * caller wins.
 *
 * A member with no in-class reference at all is not counted either. It may be called from outside,
 * and nothing here can see that.
 */
function handlersOf(cls: ts.ClassDeclaration): Set<string> {
  const inHandler = new Set<string>();
  const elsewhere = new Set<string>();

  (function look(node: ts.Node): void {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ThisKeyword &&
      ts.isIdentifier(node.name)
    ) {
      (enclosingEventAttribute(node) === undefined ? elsewhere : inHandler).add(node.name.text);
    }
    ts.forEachChild(node, look);
  })(cls);

  for (const name of elsewhere) inHandler.delete(name);
  return inHandler;
}

/**
 * `requestKey(label, { exposeToClient: true })` — whether the key this read names may travel.
 *
 * `undefined` means the question could not be answered: the key is not a local binding of a
 * `requestKey` call, or its options are computed. Both go quiet, because a rule that reported an
 * unresolved key would be reporting its own blindness.
 */
function keyIsExposed(argument: ts.Expression, context: RuleContext): boolean | undefined {
  if (!ts.isIdentifier(argument)) return undefined;
  const declaration = context.resolve(argument)?.declarations?.[0];
  if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return undefined;

  const initializer = declaration.initializer;
  if (initializer === undefined || !ts.isCallExpression(initializer)) return undefined;

  const callee = initializer.expression;
  // By the name the MODULE exports, so `import { requestKey as key }` and a re-export both reach.
  if (!ts.isIdentifier(callee)) return undefined;
  if (!importedFromCore(callee, context.resolveLocal, context.resolveStep, "requestKey")) return undefined;

  const options = initializer.arguments[1];
  // No options at all is a decided answer, not an unknown one: the default is not exposed.
  if (options === undefined) return false;
  if (!ts.isObjectLiteralExpression(options)) return undefined;

  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property)) return undefined;
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name;
    const named = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
    if (named !== "exposeToClient") continue;
    if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (property.initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
    return undefined;
  }
  return false;
}

export const clientOnlyRequestRead = {
  id: "client-only-request-read",

  report: {
    // A warning, which is this repository's rule for a new rule: one version that says so, the next
    // that refuses.
    severity: "warn",
    reportedWhen:
      "a `requestContext()` read is on a path that only runs in the browser, where the value it names is never available",
    alsoReportedAs: "RMD025",
    heading: (found) => {
      const guilty = new Set(found.map((issue) => issue.component)).size;
      return (
        `${guilty} component(s) reading per-request data where it can never be` +
        `${found.length === guilty ? "" : ` — ${found.length} reads`}:`
      );
    },
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}>.${issue.member} reads \`${issue.read}\`, and ${issue.because}.`,
      `    ${issue.clientOnly}, so this line only ever runs there.`,
    ],
    advice:
      "The browser's request scope carries the live `url`, the values whose keys opted into\n" +
      "`exposeToClient` and which the server seeded — and nothing else. Cookies and headers are\n" +
      "never among them: a cookie belongs to the server, and an httpOnly one is invisible to\n" +
      "JavaScript in any case.\n\n" +
      "So read the request where it exists and keep the answer. `@created` and `@mounted` default to\n" +
      "`shared`, which means they run during the server render too, and `@state` is what carries a\n" +
      "value across to the browser:\n\n" +
      "    @created seedUser() { this.user = requestContext().get(currentUser); }\n\n" +
      "That also survives hydration: `@created` is skipped on the client and the state is restored\n" +
      "from the page, so the browser never re-reads the request at all.\n\n" +
      "If the value really is needed in the browser, opt its key in —\n" +
      '`requestKey("currentUser", { exposeToClient: true })` — and expose only what is safe to\n' +
      "publish: a display name, an id, a role, never a session token. A key that is exposed is not\n" +
      "reported here, because whether the server seeded it is a runtime fact.\n\n" +
      "`requestContext().url` is live in the browser and is never reported.\n\n" +
      "A STATIC build will not catch this for you. The read never runs during the render, so the\n" +
      "build's per-request poison is never touched: the page bakes cleanly and the fault arrives in\n" +
      "the browser as RMD025. That is the reason this rule exists.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, context) {
    const found: ClientOnlyRequestReadIssue[] = [];
    const handlers = handlersOf(cls);

    /** `requestContext()` — core's export, not any function of that name. */
    const isRequestContextCall = (node: ts.Node): node is ts.CallExpression => {
      if (!ts.isCallExpression(node)) return false;
      const callee = node.expression;
      const id = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : undefined;
      if (!id) return false;
      // The name the MODULE exports it under, not the one this file gave it — see `core-import.ts`.
      if (ts.isPropertyAccessExpression(callee)) {
        return (
          id.text === "requestContext" && importedFromCore(callee.expression, context.resolveLocal, context.resolveStep)
        );
      }
      return importedFromCore(id, context.resolveLocal, context.resolveStep, "requestContext");
    };

    /**
     * What a `requestContext()` call is read FOR, when that is one of the three the browser cannot
     * have. `undefined` for `url`, for an exposed key, and for anything unresolved.
     */
    const readOf = (call: ts.CallExpression): { read: string; because: string } | undefined => {
      const access = call.parent;
      if (!ts.isPropertyAccessExpression(access) || access.expression !== call) return undefined;
      const field = access.name.text;

      if (field === "headers") {
        return { read: "requestContext().headers", because: "headers are never sent to the browser" };
      }

      if (field === "cookies") {
        const inner = access.parent;
        if (!ts.isPropertyAccessExpression(inner)) return undefined;
        const method = inner.name.text;
        if (method !== "get" && method !== "has") return undefined;
        return {
          read: `requestContext().cookies.${method}(…)`,
          because: "cookies are never sent to the browser",
        };
      }

      if (field === "get") {
        const invocation = access.parent;
        if (!ts.isCallExpression(invocation) || invocation.expression !== access) return undefined;
        const keyArgument = invocation.arguments[0];
        if (keyArgument === undefined) return undefined;
        const exposed = keyIsExposed(keyArgument, context);
        // `true` is a runtime question and `undefined` is this rule's blindness. Only a key PROVED
        // not to be exposed is reported.
        if (exposed !== false) return undefined;
        return {
          read: `requestContext().get(${keyArgument.getText()})`,
          because: `\`${keyArgument.getText()}\` was not declared \`{ exposeToClient: true }\``,
        };
      }

      return undefined;
    };

    const collect = (root: ts.Node, member: string, clientOnly: string): void => {
      (function look(node: ts.Node): void {
        if (isRequestContextCall(node)) {
          /**
           * Narrowed to the SERVER inside a member only the browser runs, which means it never
           * runs at all.
           *
           * The claim here is that the browser reads a value it does not have. Guarded, it does not
           * read it, so the claim is untrue and the report goes — the same answer
           * `server-env-in-shared-code` gives to the same guard, because two rules disagreeing
           * about one `typeof window` is the drift `side-guard.ts` exists to prevent.
           *
           * The argument the other way, written down because it is not silly: a server guard inside
           * a click handler is DEAD code, so silencing it lets confused code through. That is worth
           * less than the rule staying honest about what it claims — and a checker that reports a
           * line which cannot execute is one people stop believing.
           */
          if (narrowedTo(node, "server")) return;
          const what = readOf(node);
          if (what !== undefined) {
            found.push({ component: context.self.name, member, ...what, clientOnly, ...positionOf(node) });
          }
        }
        ts.forEachChild(node, look);
      })(root);
    };

    for (const member of cls.members) {
      const name = memberName(member);

      const because = clientOnlyBecause(member, context);
      if (because !== undefined) {
        collect(member, name ?? "(anonymous)", because);
        continue;
      }

      if (name !== undefined && handlers.has(name)) {
        collect(member, name, "It is only ever reached from a JSX event handler");
        continue;
      }

      // Not client-only as a whole — but an arrow written INSIDE a JSX event attribute is, whatever
      // holds it. `render()` runs on both sides; the handler it writes runs on one.
      (function look(node: ts.Node): void {
        if (
          (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
          enclosingEventAttribute(node) !== undefined
        ) {
          collect(node, name ?? "render", "It is written inside a JSX event attribute");
          return;
        }
        ts.forEachChild(node, look);
      })(member);
    }

    return found;
  },
} as const satisfies Rule<ClientOnlyRequestReadIssue>;
