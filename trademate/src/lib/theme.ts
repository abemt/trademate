export type Theme = "dark" | "light";

const KEY = "tm_theme";

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // private mode
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#eef0f4" : "#0b0e13");
}

export function currentTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme) ?? "dark";
}

export function initTheme(): void {
  let theme: Theme = "dark";
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") theme = saved;
  } catch {
    // private mode
  }
  applyTheme(theme);
}
