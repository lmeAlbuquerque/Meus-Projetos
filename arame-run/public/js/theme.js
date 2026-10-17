export function applyTheme() {
  document.documentElement.dataset.theme = "arame";
}

export async function loadTheme() {
  applyTheme();
}
