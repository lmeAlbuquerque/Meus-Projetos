import { select } from "./supabase-rest.js";

const themes = new Set(["arame", "ember", "sunset"]);

export function applyTheme(theme) {
  document.documentElement.dataset.theme = themes.has(theme) ? theme : "arame";
}

export async function loadTheme() {
  try {
    const rows = await select("app_theme_settings", {
      select: "theme",
      singleton: "eq.true",
      limit: "1",
    });
    applyTheme(rows[0]?.theme);
  } catch (error) {
    console.error("Unable to load the shared Arame RUN theme.", error);
    applyTheme("arame");
  }
}
