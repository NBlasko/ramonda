// packages/core/src/debug/logger.ts

/**
 * Captured before `installPurityGuard` patches it.
 *
 * Without this the framework reports ITSELF: a diagnostic raised during a render calls
 * `randomUUID` for the log entry's id, the guard sees randomness in a render, and
 * RMD021 fires attributed to whatever was rendering. Measured — it broke three of
 * core's own diagnostic tests, which asserted one code and got that one.
 */
const nativeRandomUUID = typeof crypto !== "undefined" ? crypto.randomUUID.bind(crypto) : () => "no-crypto";

// In-memory log history, replayed to the devtools when it connects. Bounded by
// a ring buffer so a long session can't grow it without limit.
const MAX_VAULT_LOGS = 500;

/** One line of the history, as the vault holds it and as the devtools panel receives it. */
interface LogEntry {
  type: LogType;
  message: string;
  /** Whatever the call site had to hand — a value, an object, an `Error`. Printed and rendered, never read. */
  data?: unknown;
  timestamp: string;
  id: string;
}

type LogType = "warning" | "error" | "info";

const RAMONDA_LOG_VAULT: LogEntry[] = [];

export const ramondaLog = (type: LogType, message: string, data?: unknown) => {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    const logEntry = {
      type,
      message,
      data,
      timestamp: new Date().toLocaleTimeString(),
      id: nativeRandomUUID(),
    };
    // All the presentation — colours, labels — lives here.
    const COLORS = {
      warning: { bg: "#ffcc00", text: "#000", label: "Ramonda Warning" },
      error: { bg: "#ea4335", text: "#fff", label: "Ramonda Error" },
      info: { bg: "#00aaff", text: "#fff", label: "Ramonda Info" },
    };

    // 1. Keep it in the vault (dropping the oldest past the cap).
    RAMONDA_LOG_VAULT.push(logEntry);
    if (RAMONDA_LOG_VAULT.length > MAX_VAULT_LOGS) RAMONDA_LOG_VAULT.shift();

    const style = COLORS[type];

    // 2. Print to the browser console.
    console.log(
      `%c ${style.label} %c`,
      `background: ${style.bg}; color: ${style.text}; font-weight: bold; border-radius: 3px 0 0 3px;`,
      `background: #333; color: #fff; border-radius: 0 3px 3px 0; padding: 0 5px;`,
      `\n${message}`,
      data ? "\n" : "",
      data || "",
    );

    // 3. Emit the event, for a devtools panel that is already open.
    window.dispatchEvent(new CustomEvent("ramonda:dev-log", { detail: logEntry }));
  }
};

// Waits for the devtools panel to wake up. A panel opened after the logs were
// written would otherwise start empty, missing everything that happened during
// startup — which is where the interesting diagnostics tend to be.
if (typeof __DEV__ !== "undefined" && __DEV__) {
  window.addEventListener("ramonda:devtools-ready", () => {
    // As soon as it says it is ready, hand over the whole vault.
    window.dispatchEvent(
      new CustomEvent("ramonda:logs-sync", {
        detail: RAMONDA_LOG_VAULT,
      }),
    );
  });
}
