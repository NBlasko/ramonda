// packages/core/src/debug/logger.ts

// packages/core/src/debug/logger.ts

// In-memory log history, replayed to the devtools when it connects. Bounded by
// a ring buffer so a long session can't grow it without limit.
const MAX_VAULT_LOGS = 500;
const RAMONDA_LOG_VAULT: any[] = [];

export const ramondaLog = (type: "warning" | "error" | "info", message: string, data?: any) => {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    const logEntry = {
      type,
      message,
      data,
      timestamp: new Date().toLocaleTimeString(),
      id: crypto.randomUUID(),
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
