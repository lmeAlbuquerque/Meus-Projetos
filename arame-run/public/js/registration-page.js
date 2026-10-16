import { validateRegistration } from "./core.js";
import { edgeFunction, select } from "./supabase-rest.js";
import { loadTheme } from "./theme.js";

const form = document.querySelector("#registration-form");
const editionSelect = document.querySelector("#edition");
const categorySelect = document.querySelector("#category");
const shirtSelect = document.querySelector("#shirt-size");
const message = document.querySelector("#form-message");
let categories = [];
let shirtDistributionEnabled = false;
let shirtOptions = [];

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function setOptions(selectElement, options, placeholder, valueOf, labelOf) {
  selectElement.replaceChildren(new Option(placeholder, ""));
  for (const item of options) selectElement.add(new Option(labelOf(item), valueOf(item)));
}

async function loadEditions() {
  const editions = await select("editions", {
    select: "id,name,year",
    status: "eq.open",
    order: "year.desc",
  });
  setOptions(editionSelect, editions, "Selecione a edicao", (row) => row.id,
    (row) => `${row.name} (${row.year})`);
}

editionSelect.addEventListener("change", async () => {
  categorySelect.disabled = true;
  try {
    const [editionCategories, editionSettings] = await Promise.all([
      select("categories", {
        select: "id,name,distance_km,price_cents",
        edition_id: `eq.${editionSelect.value}`,
        is_active: "eq.true",
        order: "distance_km.asc",
      }),
      select("edition_public_settings", {
        select: "distribute_shirt,shirt_options",
        edition_id: `eq.${editionSelect.value}`,
        limit: "1",
      }),
    ]);
    categories = editionCategories;
    const settings = editionSettings[0] ?? {};
    shirtDistributionEnabled = settings.distribute_shirt === true;
    shirtOptions = settings.shirt_options ?? [];
    document.querySelector("#shirt-field").hidden = true;
    shirtSelect.required = false;
    setOptions(categorySelect, categories, "Selecione a categoria", (row) => row.id,
      (row) => `${row.name} - ${row.distance_km} km - R$ ${(row.price_cents / 100).toFixed(2)}`);
    categorySelect.disabled = false;
    shirtSelect.replaceChildren(new Option("Selecione a categoria primeiro", ""));
  } catch (error) {
    showMessage(error.message, true);
  }
});

categorySelect.addEventListener("change", () => {
  const options = shirtOptions;
  const enabled = shirtDistributionEnabled;
  document.querySelector("#shirt-field").hidden = !enabled;
  shirtSelect.required = enabled;
  shirtSelect.replaceChildren(new Option(enabled ? "Selecione" : "Nao se aplica", ""));
  for (const option of options) shirtSelect.add(new Option(option, option));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const problems = validateRegistration(data);
  if (problems.length) return showMessage(problems.join(" "), true);
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  showMessage("Enviando inscricao...");
  try {
    const result = await edgeFunction("public-registration", data);
    location.assign(result.statusUrl);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

loadEditions().catch((error) => showMessage(error.message, true));
loadTheme();
