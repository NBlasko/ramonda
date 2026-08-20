/** A utility in ANOTHER FILE that writes what an element looks like. */
export function applyTheme(dark: boolean): void {
  document.body.classList.toggle("dark", dark);
}
