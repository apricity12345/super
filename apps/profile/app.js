import { profile } from "./content.js";
import { renderPage, resolveTheme, toggleTheme } from "./render.js";

const THEME_STORAGE_KEY = "profile-theme";
const THEME_COLORS = {
  light: "#f6f5f1",
  dark: "#101210",
};
const root = document.documentElement;
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

function readStoredTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function currentStoredTheme() {
  const stored = readStoredTheme();
  return stored === "light" || stored === "dark" ? stored : null;
}

function saveTheme(nextTheme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch {
    // 隐私模式或存储被禁用时，主题只在当前页面生效。
  }
}

let theme = resolveTheme(currentStoredTheme(), systemTheme.matches);

function applyTheme(nextTheme) {
  theme = nextTheme;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.setAttribute("content", THEME_COLORS[theme]);
  }

  const toggle = document.querySelector("[data-theme-toggle]");
  if (toggle) {
    const label = theme === "dark" ? "切换到浅色模式" : "切换到深色模式";
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-pressed", String(theme === "dark"));
    toggle.setAttribute("title", label);
  }
}

const app = document.querySelector("#app");
if (app) {
  app.innerHTML = renderPage(profile, { year: new Date().getFullYear() });
  applyTheme(theme);

  const toggle = app.querySelector("[data-theme-toggle]");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const nextTheme = toggleTheme(theme);
      applyTheme(nextTheme);
      saveTheme(nextTheme);
    });
  }
}

systemTheme.addEventListener("change", (event) => {
  if (currentStoredTheme() === null) {
    applyTheme(resolveTheme(null, event.matches));
  }
});

window.addEventListener("storage", (event) => {
  if (event.key !== THEME_STORAGE_KEY) {
    return;
  }
  if (event.newValue === "light" || event.newValue === "dark") {
    applyTheme(event.newValue);
  } else {
    applyTheme(resolveTheme(null, systemTheme.matches));
  }
});
