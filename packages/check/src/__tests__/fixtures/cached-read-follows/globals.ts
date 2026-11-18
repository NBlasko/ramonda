// A script: no import, no export — its top-level `let` is a global any other script can assign.
let scriptTheme = "light";
function useDark(): void {
  scriptTheme = "dark";
}

// A global nothing in view writes — still a global, which any script may write.
let scriptLang = "en";
