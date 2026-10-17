import { escapeCsv } from "./core.js";
import {
  adminEdgeFunction,
  adminRpc,
  adminSelect,
  adminSelectPage,
  adminWrite,
  getProfile,
  signIn,
} from "./supabase-rest.js";
import { loadTheme } from "./theme.js";

const loginCard = document.querySelector("#login-card");
const adminPanel = document.querySelector("#admin-panel");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const adminMessage = document.querySelector("#admin-message");
const rowsElement = document.querySelector("#registrations");
const managementMessage = document.querySelector("#management-message");
const pageSize = 20;
const pageDetails = {
  registrations: {
    title: "Inscricoes",
    kicker: "GESTAO DA CORRIDA",
    description: "Acompanhe participantes, pagamentos e situacao das inscricoes.",
  },
  editions: {
    title: "Edicoes",
    kicker: "TEMPORADAS",
    description: "Organize as edicoes anuais e configure cada temporada.",
  },
  categories: {
    title: "Categorias",
    kicker: "PROVAS E VAGAS",
    description: "Defina distancias, faixas etarias, valores e disponibilidade.",
  },
  settings: {
    title: "Comunicacao",
    kicker: "INFORMACOES AO PARTICIPANTE",
    description: "Configure o contato oficial da organizacao.",
  },
  admins: {
    title: "Administradores",
    kicker: "ACESSOS",
    description: "Gerencie os acessos da equipe organizadora.",
  },
  appearance: {
    title: "Aparencia",
    kicker: "IDENTIDADE ARAME RUN",
    description: "Paleta fixa em preto, cinza e laranja.",
  },
};
let page = 0;
let editionPage = 0;
let categoryPage = 0;
let categoryPricePage = 0;
let adminsPage = 0;
let session = null;
let role = null;
let sortColumn = "registration_number";
let sortAscending = true;
let searchTimer = null;
let managedEdition = null;
let editingCategoryId = null;
let categoryCatalog = [];
let activityRequestId = 0;

function announce(element, text, error = false) {
  element.textContent = text;
  element.classList.toggle("error", error);
}

function cell(row, text) {
  const td = document.createElement("td");
  td.textContent = text ?? "";
  row.append(td);
  return td;
}

function activateLocalTab(tab) {
  const tabList = tab.closest('[role="tablist"]');
  for (const button of tabList.querySelectorAll('[role="tab"]')) {
    const selected = button === tab;
    button.setAttribute("aria-selected", String(selected));
    document.querySelector(`#${button.getAttribute("aria-controls")}`).hidden = !selected;
  }
}

function switchView(viewName, { updateHistory = true } = {}) {
  if (!pageDetails[viewName] || (role === "read_only" && viewName !== "registrations")) {
    viewName = "registrations";
  }
  const currentPanel = document.querySelector("[data-view-panel]:not([hidden])");
  for (const panel of document.querySelectorAll("[data-view-panel]")) {
    panel.hidden = panel.dataset.viewPanel !== viewName;
    panel.setAttribute("aria-hidden", String(panel.hidden));
  }
  for (const button of document.querySelectorAll("#module-nav [data-view]")) {
    const selected = button.dataset.view === viewName;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-current", selected ? "page" : "false");
  }
  const details = pageDetails[viewName];
  document.querySelector("#page-title").textContent = details.title;
  document.querySelector("#page-kicker").textContent = details.kicker;
  document.querySelector("#page-description").textContent = details.description;
  document.title = `${details.title} | Administracao | Arame RUN`;
  const nextPanel = document.querySelector(`[data-view-panel="${viewName}"]`);
  if (currentPanel !== nextPanel && nextPanel) {
    nextPanel.classList.remove("page-enter");
    void nextPanel.offsetWidth;
    nextPanel.classList.add("page-enter");
  }
  if (updateHistory && location.hash !== `#${viewName}`) {
    history.pushState({ view: viewName }, "", `#${viewName}`);
  }
}

async function loadEditions() {
  const editions = await adminSelect("editions",
    { select: "id,name,year,status", order: "year.desc" }, session.access_token);
  categoryCatalog = await adminSelect("category_catalog", {
    select: "id,name,distance_km,min_age,max_age,gender_rule",
    order: "name.asc,id.asc",
  }, session.access_token);
  const select = document.querySelector("#edition-filter");
  const previousFilter = select.value;
  select.replaceChildren(new Option("Selecione", ""));
  for (const edition of editions) select.add(new Option(`${edition.name} (${edition.year})`, edition.id));
  const managed = document.querySelector("#managed-edition");
  const previousManaged = managed.value;
  const settingsEdition = document.querySelector("#settings-edition");
  const previousSettings = settingsEdition.value;
  settingsEdition.replaceChildren(new Option("Selecione uma edicao", ""));
  const categoryEdition = document.querySelector("#category-edition-select");
  const previousCategoryEdition = categoryEdition.value;
  categoryEdition.replaceChildren(new Option("Selecione uma edicao", ""));
  for (const edition of editions) {
    const label = `${edition.name} (${edition.year})`;
    settingsEdition.add(new Option(label, edition.id));
    categoryEdition.add(new Option(label, edition.id));
  }
  select.value = editions.some((edition) => edition.id === previousFilter) ? previousFilter : "";
  managed.value = editions.some((edition) => edition.id === previousManaged) ? previousManaged : "";
  settingsEdition.value = editions.some((edition) => edition.id === previousSettings) ? previousSettings : managed.value;
  categoryEdition.value = editions.some((edition) => edition.id === previousCategoryEdition)
    ? previousCategoryEdition
    : editions.some((edition) => edition.id === managed.value)
      ? managed.value
      : editions[0]?.id ?? "";
  renderCategoryCheckboxes("#edition-create-category-options", []);
  await loadEditionRows();
  await loadEditionCategoryPrices(categoryEdition.value);
  await loadCategoryCatalog();
  select.onchange = () => {
    page = 0;
    loadReport();
    loadRegistrations();
    if (document.querySelector("#registrations-chart-tab").getAttribute("aria-selected") === "true") {
      loadRegistrationActivity();
    }
  };
  settingsEdition.onchange = () => {
    managed.value = settingsEdition.value;
  };
  categoryEdition.onchange = async () => {
    categoryPricePage = 0;
    try {
      await loadEditionCategoryPrices(categoryEdition.value);
    } catch (error) {
      setMessage(error.message, true);
    }
  };
}

function renderCategoryCheckboxes(selector, selectedIds) {
  const container = document.querySelector(selector);
  container.replaceChildren();
  if (!categoryCatalog.length) {
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = "Cadastre primeiro as categorias gerais na secao Categorias.";
    container.append(message);
    return;
  }
  for (const category of categoryCatalog) {
    const label = document.createElement("label");
    label.className = "checkbox category-availability-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "categoryIds";
    checkbox.value = category.id;
    checkbox.checked = selectedIds.includes(category.id);
    const text = document.createElement("span");
    text.textContent = `${category.name} - ${category.distance_km} km`;
    label.append(checkbox, text);
    container.append(label);
  }
}

async function loadEditionRows() {
  const requestedPage = editionPage;
  const result = await adminSelectPage("editions", {
    select: "id,name,year,status",
    order: "created_at.desc,id.desc",
    limit: String(pageSize),
    offset: String(editionPage * pageSize),
  }, session.access_token);
  const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
  if (editionPage >= pageCount) editionPage = pageCount - 1;
  if (editionPage !== requestedPage) {
    return loadEditionRows();
  }
  renderEditionRows(result.rows);
  document.querySelector("#editions-page-label").textContent = `Pagina ${editionPage + 1} de ${pageCount}`;
  document.querySelector("#editions-previous-page").disabled = editionPage === 0;
  document.querySelector("#editions-next-page").disabled = editionPage >= pageCount - 1;
}

function renderEditionRows(editions) {
  const body = document.querySelector("#editions-list");
  body.replaceChildren();
  if (!editions.length) {
    const row = document.createElement("tr");
    const empty = cell(row, "Nenhuma edicao cadastrada.");
    empty.colSpan = 4;
    body.append(row);
    return;
  }
  for (const edition of editions) {
    const row = document.createElement("tr");
    cell(row, edition.name);
    cell(row, String(edition.year));
    cell(row, {
      draft: "Rascunho",
      open: "Inscricoes abertas",
      closed: "Encerrada",
      archived: "Arquivada",
    }[edition.status] ?? edition.status);
    const actions = document.createElement("td");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary";
    edit.textContent = "Editar";
    edit.addEventListener("click", () => {
      document.querySelector("#managed-edition").value = edition.id;
      document.querySelector("#settings-edition").value = edition.id;
      document.querySelector("#category-edition-select").value = edition.id;
      categoryPricePage = 0;
      loadEditionEditor(edition.id)
        .then(() => loadEditionCategoryPrices(edition.id))
        .then(() => document.querySelector("#edition-settings").scrollIntoView({ behavior: "smooth", block: "start" }))
        .catch((error) => setMessage(error.message, true));
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Excluir";
    remove.addEventListener("click", () => deleteEdition(edition, remove));
    actions.append(edit, remove);
    row.append(actions);
    body.append(row);
  }
}

function setMessage(text, isError = false) {
  announce(managementMessage, text, isError);
}

async function deleteEdition(edition, button) {
  if (!["primary", "developer"].includes(role)) {
    return setMessage("Somente a administradora principal ou DEV pode excluir edicoes.", true);
  }
  if (edition.status === "open") {
    return setMessage("Feche as inscricoes e salve a edicao antes de apaga-la.", true);
  }
  const confirmation = window.prompt(
    `A exclusao e permanente e apagara tambem participantes, pagamentos e historicos.\n\nDigite exatamente o nome da edicao para confirmar:\n${edition.name}`,
  );
  if (confirmation === null) return;
  if (confirmation !== edition.name) {
    return setMessage("O texto digitado precisa ser exatamente igual ao nome da edicao.", true);
  }
  if (!window.confirm(
    `Apagar permanentemente "${edition.name}" e todos os dados vinculados? Esta acao nao pode ser desfeita.`,
  )) return;

  button.disabled = true;
  try {
    const deletedCount = await adminRpc("delete_edition_and_registrations", {
      p_edition_id: edition.id,
      p_confirmation: confirmation,
    }, session.access_token);
    const wasRegistrationEdition = document.querySelector("#edition-filter").value === edition.id;
    const managedEditionSelected = document.querySelector("#managed-edition").value === edition.id;
    const settingsEditionSelected = document.querySelector("#settings-edition").value === edition.id;
    if (managedEditionSelected || settingsEditionSelected) {
      document.querySelector("#managed-edition").value = "";
      document.querySelector("#settings-edition").value = "";
      await loadEditionEditor("");
    }
    if (document.querySelector("#category-edition-select").value === edition.id) {
      document.querySelector("#category-edition-select").value = "";
      categoryPricePage = 0;
      await loadEditionCategoryPrices("");
    }
    if (wasRegistrationEdition) {
      document.querySelector("#edition-filter").value = "";
      page = 0;
    }
    editionPage = 0;
    await loadEditions();
    if (wasRegistrationEdition) {
      await loadReport();
      await loadRegistrations();
    }
    setMessage(`Edicao apagada permanentemente. Inscricoes removidas: ${deletedCount}. O ano ficou bloqueado para evitar reutilizar a numeracao.`);
  } catch (error) {
    setMessage(`Nao foi possivel excluir a edicao. Verifique se a migration 007 ja foi executada. Detalhe: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

function updateWhatsAppPreview(number) {
  const link = document.querySelector("#whatsapp-preview");
  const normalized = String(number ?? "").replace(/\D/g, "");
  link.hidden = !/^[1-9][0-9]{7,14}$/.test(normalized);
  link.href = link.hidden ? "#" : `https://wa.me/${normalized}`;
}

async function loadEditionEditor(editionId, knownEditions = null) {
  const form = document.querySelector("#edition-edit-form");
  const settingsPanel = document.querySelector("#edition-settings");
  const editions = knownEditions ?? await adminSelect("editions", {
    select: "id,name,year,status",
    id: `eq.${editionId}`,
  }, session.access_token);
  const edition = editions.find((item) => item.id === editionId);
  if (!editionId || !edition) {
    managedEdition = null;
    settingsPanel.hidden = true;
    form.reset();
    const settings = document.querySelector("#settings-form");
    settings.reset();
    settings.elements.edition.value = "";
    document.querySelector("#whatsapp-preview").hidden = true;
    document.querySelector("#payment-instructions-form").reset();
    document.querySelector("#edition-edit-category-options").replaceChildren();
    return;
  }
  managedEdition = edition;
  settingsPanel.hidden = false;
  form.elements.year.value = edition.year;
  form.elements.name.value = edition.name;
  form.elements.status.value = edition.status;
  document.querySelector("#settings-edition").value = editionId;
  const settingsRows = await adminSelect("edition_public_settings", {
    select: "whatsapp_number,pix_instructions,distribute_shirt,shirt_options",
    edition_id: `eq.${editionId}`,
  }, session.access_token);
  const settings = document.querySelector("#settings-form");
  const record = settingsRows[0] ?? {};
  settings.elements.whatsappNumber.value = record.whatsapp_number ?? "";
  document.querySelector("#payment-instructions-form").elements.pixInstructions.value =
    record.pix_instructions ?? "";
  const shirtForm = document.querySelector("#shirt-settings-form");
  const shirtOptions = record.shirt_options ?? [];
  shirtForm.elements.distributeShirt.checked = record.distribute_shirt === true;
  for (const option of shirtForm.querySelectorAll('input[name="shirtOptions"]')) {
    option.checked = shirtOptions.includes(option.value);
  }
  const selectedCategories = await adminSelect("categories", {
    select: "catalog_category_id",
    edition_id: `eq.${editionId}`,
    is_active: "eq.true",
  }, session.access_token);
  renderCategoryCheckboxes("#edition-edit-category-options",
    selectedCategories.map((category) => category.catalog_category_id));
  updateWhatsAppPreview(record.whatsapp_number ?? "");
}

async function loadCategoryCatalog() {
  const body = document.querySelector("#categories-list");
  body.replaceChildren();
  const requestedPage = categoryPage;
  const result = await adminSelectPage("category_catalog", {
    select: "id,name,distance_km,min_age,max_age,gender_rule",
    order: "name.asc,id.asc",
    limit: String(pageSize),
    offset: String(categoryPage * pageSize),
  }, session.access_token);
  const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
  if (categoryPage >= pageCount) categoryPage = pageCount - 1;
  if (categoryPage !== requestedPage) return loadCategoryCatalog();
  document.querySelector("#categories-page-label").textContent = `Pagina ${categoryPage + 1} de ${pageCount}`;
  document.querySelector("#categories-previous-page").disabled = categoryPage === 0;
  document.querySelector("#categories-next-page").disabled = categoryPage >= pageCount - 1;
  if (!result.rows.length) {
    const row = document.createElement("tr");
    const empty = cell(row, "Nenhuma categoria geral cadastrada.");
    empty.colSpan = 4;
    body.append(row);
    return;
  }
  for (const category of result.rows) {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const name = document.createElement("strong");
    name.textContent = category.name;
    const actions = document.createElement("div");
    actions.className = "category-row-actions";
    nameCell.append(name, actions);
    row.append(nameCell);
    cell(row, `${category.distance_km} km`);
    cell(row, `${category.min_age ?? "—"} a ${category.max_age ?? "—"}`);
    cell(row, { any: "Ambos", female: "Feminino", male: "Masculino" }[category.gender_rule]);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary";
    edit.textContent = "Editar";
    edit.addEventListener("click", () => {
      const form = document.querySelector("#category-form");
      editingCategoryId = category.id;
      form.elements.name.value = category.name;
      form.elements.distance.value = category.distance_km;
      form.elements.minAge.value = category.min_age ?? "";
      form.elements.maxAge.value = category.max_age ?? "";
      form.elements.genderRule.value = category.gender_rule;
      document.querySelector("#save-category").textContent = "Salvar categoria";
      document.querySelector("#cancel-category-edit").hidden = false;
      document.querySelector("#category-create-tab").click();
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    actions.append(edit);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Excluir";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Excluir permanentemente a categoria geral "${category.name}" e removela de todas as edicoes? Categorias com inscricoes vinculadas nao podem ser excluidas.`)) return;
      remove.disabled = true;
      try {
        await adminRpc("delete_category_catalog", {
          p_category_id: category.id,
        }, session.access_token);
        if (editingCategoryId === category.id) resetCategoryEditor();
        await loadEditions();
        setMessage("Categoria excluida.");
      } catch (error) {
        setMessage(`Nao foi possivel excluir a categoria geral. Ela pode estar vinculada a inscricoes. Detalhe: ${error.message}`, true);
      } finally {
        remove.disabled = false;
      }
    });
    actions.append(remove);
    body.append(row);
  }
}

async function loadEditionCategoryPrices(editionId) {
  const body = document.querySelector("#edition-category-prices");
  body.replaceChildren();
  if (!editionId) {
    const row = document.createElement("tr");
    const empty = cell(row, "Selecione uma edicao para ajustar valores e vagas.");
    empty.colSpan = 4;
    body.append(row);
    document.querySelector("#category-prices-page-label").textContent = "Pagina 1 de 1";
    document.querySelector("#category-prices-previous-page").disabled = true;
    document.querySelector("#category-prices-next-page").disabled = true;
    return;
  }
  const requestedPage = categoryPricePage;
  const result = await adminSelectPage("categories", {
    select: "id,name,price_cents,capacity",
    edition_id: `eq.${editionId}`,
    is_active: "eq.true",
    order: "name.asc",
    limit: String(pageSize),
    offset: String(categoryPricePage * pageSize),
  }, session.access_token);
  const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
  if (categoryPricePage >= pageCount) categoryPricePage = pageCount - 1;
  if (categoryPricePage !== requestedPage) return loadEditionCategoryPrices(editionId);
  document.querySelector("#category-prices-page-label").textContent =
    `Pagina ${categoryPricePage + 1} de ${pageCount}`;
  document.querySelector("#category-prices-previous-page").disabled = categoryPricePage === 0;
  document.querySelector("#category-prices-next-page").disabled = categoryPricePage >= pageCount - 1;
  if (!result.rows.length) {
    const row = document.createElement("tr");
    const empty = cell(row, "Nenhuma categoria foi selecionada para esta edicao.");
    empty.colSpan = 4;
    body.append(row);
    return;
  }
  for (const category of result.rows) {
    const row = document.createElement("tr");
    cell(row, category.name);
    const priceCell = document.createElement("td");
    const price = document.createElement("input");
    price.type = "number";
    price.min = "0";
    price.step = "0.01";
    price.required = true;
    price.value = (category.price_cents / 100).toFixed(2);
    price.setAttribute("aria-label", `Valor de ${category.name}`);
    priceCell.append(price);
    row.append(priceCell);
    const capacityCell = document.createElement("td");
    const capacity = document.createElement("input");
    capacity.type = "number";
    capacity.min = "1";
    capacity.value = category.capacity ?? "";
    capacity.placeholder = "Sem limite";
    capacity.setAttribute("aria-label", `Limite de vagas de ${category.name}`);
    capacityCell.append(capacity);
    row.append(capacityCell);
    const action = document.createElement("td");
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Salvar";
    save.addEventListener("click", async () => {
      const amount = Number(price.value);
      const capacityLimit = capacity.value ? Number(capacity.value) : null;
      if (!price.value || !Number.isFinite(amount) || amount < 0 || price.validity.stepMismatch) {
        setMessage("Informe um valor valido, igual ou maior que zero.", true);
        return;
      }
      if (capacityLimit !== null && (!Number.isInteger(capacityLimit) || capacityLimit < 1)) {
        setMessage("O limite de vagas deve ser um numero inteiro maior que zero ou ficar vazio para sem limite.", true);
        return;
      }
      save.disabled = true;
      try {
        await adminWrite("categories", { id: `eq.${category.id}` }, "PATCH", {
          price_cents: Math.round(amount * 100),
          capacity: capacityLimit,
        }, session.access_token);
        setMessage(`Valor e limite da categoria "${category.name}" atualizados para esta edicao.`);
      } catch (error) {
        setMessage(`Nao foi possivel atualizar os valores de "${category.name}". Detalhe: ${error.message}`, true);
      } finally {
        save.disabled = false;
      }
    });
    action.append(save);
    row.append(action);
    body.append(row);
  }
}

function resetCategoryEditor() {
  const form = document.querySelector("#category-form");
  form.reset();
  editingCategoryId = null;
  document.querySelector("#save-category").textContent = "Adicionar categoria";
  document.querySelector("#cancel-category-edit").hidden = true;
}

async function loadAdmins() {
  const requestedPage = adminsPage;
  const result = await adminSelectPage("admin_profiles", {
    select: "user_id,email,role,is_active,created_at,created_by",
    order: "created_at.asc",
    limit: String(pageSize),
    offset: String(adminsPage * pageSize),
  }, session.access_token);
  const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
  if (adminsPage >= pageCount) adminsPage = pageCount - 1;
  if (adminsPage !== requestedPage) return loadAdmins();
  const admins = result.rows;
  const body = document.querySelector("#admins");
  body.replaceChildren();
  let principal = admins.find((admin) => admin.role === "primary");
  if (!principal) {
    [principal] = await adminSelect("admin_profiles", {
      select: "email,role",
      role: "eq.primary",
      limit: "1",
    }, session.access_token);
  }
  document.querySelector("#admins-page-label").textContent = `Pagina ${adminsPage + 1} de ${pageCount}`;
  document.querySelector("#admins-previous-page").disabled = adminsPage === 0;
  document.querySelector("#admins-next-page").disabled = adminsPage >= pageCount - 1;
  document.querySelector("#admins-title").textContent = role === "developer"
    ? "Contas administrativas — DEV"
    : "Administradores";
  document.querySelector("#admins-description").textContent = role === "developer"
    ? `Visao global: principal atual ${principal?.email ?? "nao definida"}; secundarios vinculados a essa administracao. O acesso DEV fica oculto para a organizacao.`
    : "A administradora principal e o DEV tem as mesmas permissoes operacionais. A conta DEV nao aparece nesta lista.";
  for (const admin of admins) {
    const row = document.createElement("tr");
    cell(row, admin.email);
    cell(row, {
      developer: "DEV — proprietaria tecnica",
      primary: "Principal",
      read_only: "Somente leitura",
    }[admin.role] ?? "Desconhecido");
    cell(row, admin.role === "read_only"
      ? (principal?.email ?? "Sem administradora principal")
      : admin.role === "primary" ? "Responsavel pelos secundarios" : "Acesso tecnico global");
    cell(row, admin.is_active ? "Sim" : "Nao");
    const action = document.createElement("td");
    if (admin.role === "read_only") {
      if (role === "developer" && admin.is_active) {
        const makePrimary = document.createElement("button");
        makePrimary.type = "button";
        makePrimary.textContent = "Definir como principal";
        makePrimary.addEventListener("click", async () => {
          if (!window.confirm(`Transferir a administracao principal para ${admin.email}? O administrador principal atual passara a somente leitura.`)) return;
          makePrimary.disabled = true;
          try {
            await adminRpc("set_primary_admin", { p_user_id: admin.user_id }, session.access_token);
            await loadAdmins();
            setMessage("Administracao principal transferida. O DEV continua com acesso global.");
          } catch (error) {
            setMessage(error.message, true);
            makePrimary.disabled = false;
          }
        });
        action.append(makePrimary);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = admin.is_active ? "Desativar" : "Reativar";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await adminWrite("admin_profiles", { user_id: `eq.${admin.user_id}` }, "PATCH", {
            is_active: !admin.is_active,
          }, session.access_token);
          await loadAdmins();
          setMessage(`Conta ${admin.is_active ? "desativada" : "reativada"}.`);
        } catch (error) {
          setMessage(error.message, true);
          button.disabled = false;
        }
      });
      action.append(button);
    } else if (admin.role === "developer") {
      action.textContent = "Acesso tecnico global";
    } else {
      action.textContent = "Administrador principal";
    }
    row.append(action);
    body.append(row);
  }
}

async function loadReport() {
  const editionId = document.querySelector("#edition-filter").value;
  if (!editionId) {
    document.querySelector("#report-summary").textContent = "Selecione uma edicao para ver os totais.";
    return;
  }
  try {
    const report = await adminRpc("admin_report", { p_edition_id: editionId }, session.access_token);
    document.querySelector("#report-summary").textContent =
      `Inscritos ativos: ${report.total_active}; pagamentos confirmados: ${report.payments_confirmed}; pendentes: ${report.payments_pending}.`;
  } catch (error) {
    announce(adminMessage, error.message, true);
  }
}

function renderActivityChart(rows, granularity) {
  const container = document.querySelector("#activity-chart");
  container.replaceChildren();
  if (!rows.length) return;
  const interval = { day: "diario", month: "mensal", year: "anual" }[granularity];
  container.setAttribute("aria-label", `Grafico de inscricoes por agrupamento ${interval}`);

  const width = Math.max(900, rows.length * 42);
  const height = 340;
  const margin = { top: 24, right: 20, bottom: 62, left: 52 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maximum = rows.reduce(
    (largest, row) => Math.max(largest, Number(row.registration_count)),
    0,
  );
  const tickMaximum = Math.max(1, maximum);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("aria-hidden", "true");

  const addSvgElement = (name, attributes, parent = svg) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [attribute, value] of Object.entries(attributes)) {
      element.setAttribute(attribute, String(value));
    }
    parent.append(element);
    return element;
  };
  const definition = addSvgElement("defs", {});
  const gradient = addSvgElement("linearGradient", {
    id: "activity-chart-gradient",
    x1: "0%",
    x2: "100%",
    y1: "0%",
    y2: "0%",
  }, definition);
  addSvgElement("stop", { offset: "0%", "stop-color": "#f28b24" }, gradient);
  addSvgElement("stop", { offset: "100%", "stop-color": "#ff6b1a" }, gradient);

  for (const fraction of [0, 0.5, 1]) {
    const y = margin.top + plotHeight * (1 - fraction);
    const value = Math.round(tickMaximum * fraction);
    addSvgElement("line", {
      x1: margin.left,
      x2: width - margin.right,
      y1: y,
      y2: y,
      class: "activity-gridline",
    });
    const label = addSvgElement("text", {
      x: margin.left - 10,
      y: y + 4,
      "text-anchor": "end",
      class: "activity-axis-label",
    });
    label.textContent = String(value);
  }

  const formatDate = new Intl.DateTimeFormat("pt-BR", granularity === "day"
    ? { day: "2-digit", month: "2-digit", timeZone: "UTC" }
    : granularity === "month"
      ? { month: "short", year: "2-digit", timeZone: "UTC" }
      : { year: "numeric", timeZone: "UTC" });
  const barSlot = plotWidth / rows.length;
  const barWidth = Math.max(2, Math.min(28, barSlot * 0.66));
  const labelInterval = Math.max(1, Math.ceil(rows.length / 10));
  rows.forEach((row, index) => {
    const count = Number(row.registration_count);
    const barHeight = (count / tickMaximum) * plotHeight;
    const centerX = margin.left + barSlot * (index + 0.5);
    const bar = addSvgElement("rect", {
      x: centerX - barWidth / 2,
      y: margin.top + plotHeight - barHeight,
      width: barWidth,
      height: Math.max(1, barHeight),
      rx: Math.min(5, barWidth / 3),
      fill: "url(#activity-chart-gradient)",
    });
    const date = new Date(`${row.period_start}T12:00:00Z`);
    const title = addSvgElement("title", {}, bar);
    title.textContent = `${formatDate.format(date)}: ${count} inscricoes`;
    if (index % labelInterval === 0 || index === rows.length - 1) {
      const label = addSvgElement("text", {
        x: centerX,
        y: height - margin.bottom + 21,
        "text-anchor": "middle",
        class: "activity-axis-label",
      });
      label.textContent = formatDate.format(date);
    }
  });
  container.append(svg);
}

async function loadRegistrationActivity() {
  const chartMessage = document.querySelector("#activity-chart-message");
  const container = document.querySelector("#activity-chart");
  const editionId = document.querySelector("#edition-filter").value;
  const granularity = document.querySelector("#activity-granularity").value;
  const interval = { day: "diario", month: "mensal", year: "anual" }[granularity];
  const requestId = ++activityRequestId;
  container.replaceChildren();
  if (!editionId) {
    announce(chartMessage, "Selecione uma edicao para visualizar o grafico.");
    return;
  }

  announce(chartMessage, "Carregando os dados do grafico...");
  try {
    const rows = await adminRpc("admin_registration_activity", {
      p_edition_id: editionId,
      p_granularity: granularity,
    }, session.access_token);
    if (requestId !== activityRequestId ||
        editionId !== document.querySelector("#edition-filter").value ||
        granularity !== document.querySelector("#activity-granularity").value) return;
    renderActivityChart(rows, granularity);
    if (!rows.length) {
      announce(chartMessage, "Ainda nao ha inscricoes registradas nesta edicao.");
      return;
    }
    const total = rows.reduce((sum, row) => sum + Number(row.registration_count), 0);
    announce(chartMessage, `${total} inscricoes no total; exibindo ${rows.length} periodos em agrupamento ${interval}.`);
  } catch (error) {
    if (requestId === activityRequestId) {
      container.replaceChildren();
      announce(chartMessage, `Nao foi possivel carregar o grafico. Verifique se a migration 008 foi aplicada. Detalhe: ${error.message}`, true);
    }
  }
}

async function renewRegistrationLink(registrationId) {
  if (!window.confirm("O link atual deixara de funcionar. Deseja criar um novo link privado?")) return;
  try {
    const result = await adminEdgeFunction("rotate-registration-link", {
      registrationId,
    }, session.access_token);
    document.querySelector("#new-status-link").value = result.statusUrl;
    document.querySelector("#rotated-link").hidden = false;
    setMessage("Link renovado; o link anterior foi invalidado.");
    await loadRegistrations();
  } catch (error) {
    announce(adminMessage, error.message, true);
  }
}

async function loadRegistrations() {
  const filters = new FormData(document.querySelector("#filters"));
  const editionId = String(filters.get("editionId") ?? "");
  if (!editionId) {
    announce(adminMessage, "Selecione uma edicao.");
    rowsElement.replaceChildren();
    document.querySelector("#page-label").textContent = "Pagina 1";
    document.querySelector("#previous-page").disabled = true;
    document.querySelector("#next-page").disabled = true;
    return;
  }

  try {
    const registrations = await adminRpc("admin_registration_page", {
      p_edition_id: editionId,
      p_search: String(filters.get("search") ?? "").trim(),
      p_payment: filters.get("payment") || null,
      p_status: filters.get("status") || null,
      p_sort: sortColumn,
      p_ascending: sortAscending,
      p_limit: pageSize,
      p_offset: page * pageSize,
    }, session.access_token);
    const privateLinks = registrations.length
      ? await adminEdgeFunction("registration-private-links", {
        registrationIds: registrations.map((registration) => registration.id),
      }, session.access_token)
      : { links: [] };
    const privateLinkMap = new Map(privateLinks.links.map((link) => [link.registrationId, link]));
    rowsElement.replaceChildren();
    for (const registration of registrations) {
      const row = document.createElement("tr");
      cell(row, String(registration.registration_number));
      cell(row, registration.full_name);
      cell(row, registration.category_name);
      cell(row, `R$ ${(registration.amount_due_cents / 100).toFixed(2)}`);
      cell(row, { pending: "Pendente", confirmed: "Confirmado", refunded: "Estornado" }[registration.payment_status]);
      cell(row, registration.payment_confirmed_at
        ? new Date(registration.payment_confirmed_at).toLocaleString("pt-BR")
        : "-");
      cell(row, registration.status === "active" ? "Ativa" : "Cancelada");
      cell(row, new Date(registration.created_at).toLocaleDateString("pt-BR"));
      const privateLinkCell = document.createElement("td");
      const privateLink = privateLinkMap.get(registration.id);
      if (["primary", "developer"].includes(role)) {
        if (privateLink?.statusUrl) {
          const linkInput = document.createElement("input");
          linkInput.type = "url";
          linkInput.className = "private-link-field";
          linkInput.readOnly = true;
          linkInput.value = privateLink.statusUrl;
          linkInput.setAttribute("aria-label", `Link privado da inscricao ${registration.registration_number}`);
          const copy = document.createElement("button");
          copy.type = "button";
          copy.className = "secondary";
          copy.textContent = "Copiar";
          copy.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(privateLink.statusUrl);
              announce(adminMessage, `Link da inscricao ${registration.registration_number} copiado.`);
            } catch {
              linkInput.focus();
              linkInput.select();
              announce(adminMessage, "Nao foi possivel copiar automaticamente. Selecione e copie o link.", true);
            }
          });
          privateLinkCell.append(linkInput, copy);
        } else if (registration.status === "active") {
          const generate = document.createElement("button");
          generate.type = "button";
          generate.className = "secondary";
          generate.textContent = "Gerar novo link";
          generate.addEventListener("click", () => renewRegistrationLink(registration.id));
          privateLinkCell.append(generate);
        } else {
          privateLinkCell.textContent = "Indisponivel";
        }
      } else {
        privateLinkCell.textContent = privateLink?.available
          ? "•••••••• (oculto para perfil secundario)"
          : "Link ainda nao preparado";
        privateLinkCell.classList.add("masked-link");
        privateLinkCell.setAttribute("aria-label",
          `Link privado ${privateLink?.available ? "mascarado" : "indisponivel"} para inscricao ${registration.registration_number}`);
      }
      row.append(privateLinkCell);
      const action = document.createElement("td");
      if (["primary", "developer"].includes(role)) {
        if (registration.status === "active") {
          const correcting = registration.payment_status === "confirmed";
          const nextStatus = document.createElement("select");
          nextStatus.setAttribute("aria-label", `Novo status do pagamento da inscricao ${registration.registration_number}`);
          for (const [value, label] of (correcting
            ? [["pending", "Pendente"], ["refunded", "Estornado"]]
            : [["confirmed", "Confirmado"]])) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            nextStatus.append(option);
          }
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = correcting ? "Corrigir pagamento" : "Confirmar pagamento";
          button.addEventListener("click", async () => {
            const note = correcting
              ? window.prompt("Descreva o motivo da correcao. Esse motivo ficara no historico de auditoria:")
              : "";
            if (correcting && !note?.trim()) {
              if (note !== null) announce(adminMessage, "Informe o motivo da correcao.", true);
              return;
            }
            button.disabled = true;
            try {
              await adminRpc("confirm_registration_payment", {
                p_registration_id: registration.id,
                p_new_status: nextStatus.value,
                p_note: note?.trim() ?? "",
              }, session.access_token);
              await loadRegistrations();
              await loadReport();
            } catch (error) {
              announce(adminMessage, error.message, true);
              button.disabled = false;
            }
          });
          action.append(nextStatus, button);
          const cancel = document.createElement("button");
          cancel.type = "button";
          cancel.className = "secondary";
          cancel.textContent = "Cancelar";
          cancel.addEventListener("click", async () => {
            cancel.disabled = true;
            try {
              await adminRpc("cancel_registration", {
                p_registration_id: registration.id,
              }, session.access_token);
              await loadRegistrations();
              await loadReport();
            } catch (error) {
              announce(adminMessage, error.message, true);
              cancel.disabled = false;
            }
          });
          action.append(cancel);
          const rotate = document.createElement("button");
          rotate.type = "button";
          rotate.className = "secondary";
          rotate.textContent = "Renovar link";
          rotate.addEventListener("click", () => renewRegistrationLink(registration.id));
          action.append(rotate);
        }
      } else {
        action.textContent = "Somente leitura";
      }
      row.append(action);
      rowsElement.append(row);
    }
    announce(adminMessage, registrations.length ? "" : "Nenhuma inscricao nesta pagina.");
    document.querySelector("#page-label").textContent = `Pagina ${page + 1}`;
    document.querySelector("#previous-page").disabled = page === 0;
    document.querySelector("#next-page").disabled = registrations.length < pageSize;
    updateSortHeaders();
  } catch (error) {
    announce(adminMessage, error.message, true);
  }
}

function updateSortHeaders() {
  for (const button of document.querySelectorAll(".sort-header")) {
    const selected = button.dataset.sort === sortColumn;
    const direction = sortAscending ? "A-Z" : "Z-A";
    const label = button.dataset.label ?? button.textContent.trim();
    const ariaSort = selected ? (sortAscending ? "ascending" : "descending") : "none";
    button.dataset.label = label;
    button.textContent = `${label}${selected ? (sortAscending ? " ▲" : " ▼") : ""}`;
    button.closest("th").setAttribute("aria-sort", ariaSort);
    button.setAttribute("aria-label", `Ordenar por ${button.dataset.label}${selected ? `, ordem ${direction}` : ""}`);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(loginForm));
  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  announce(loginMessage, "Verificando acesso...");
  try {
    session = await signIn(data.email, data.password);
    const profile = await getProfile(session.access_token, session.user.id);
    if (!profile?.is_active) throw new Error("Conta sem permissao administrativa ativa.");
    role = profile.role;
    loginForm.reset();
    loginCard.hidden = true;
    adminPanel.hidden = false;
    const isManager = ["primary", "developer"].includes(role);
    document.querySelector(".admin-app").classList.toggle("is-manager", isManager);
    document.querySelector("#admin-role").textContent = {
      developer: "DEV — acesso tecnico global",
      primary: "Administradora principal",
      read_only: "Administradora secundaria — somente leitura",
    }[role];
    document.querySelector("#module-nav").hidden = !isManager;
    document.querySelector("#export-csv").hidden = !isManager;
    document.body.classList.add("is-authenticated");
    const requestedView = location.hash.slice(1);
    switchView(pageDetails[requestedView] ? requestedView : "registrations");
    announce(managementMessage, "Acesso confirmado. Carregando os dados...");
    try {
      await loadTheme();
      await loadEditions();
      if (isManager) await loadAdmins();
      announce(managementMessage, "");
    } catch (error) {
      announce(managementMessage, `Acesso confirmado, mas houve um erro ao carregar os dados do painel: ${error.message}`, true);
    }
  } catch (error) {
    session = null;
    role = null;
    document.body.classList.remove("is-authenticated");
    adminPanel.hidden = true;
    loginCard.hidden = false;
    announce(loginMessage, error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#filters").addEventListener("submit", (event) => {
  event.preventDefault();
  page = 0;
  loadRegistrations();
});
document.querySelector("#filters").elements.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page = 0;
    loadRegistrations();
  }, 250);
});
for (const field of ["payment", "status"]) {
  document.querySelector("#filters").elements[field].addEventListener("change", () => {
    page = 0;
    loadRegistrations();
  });
}
document.querySelector("#module-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) {
    switchView(button.dataset.view);
    if (innerWidth <= 660) {
      document.querySelector("#app-content").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
});
document.querySelectorAll('.local-tabs [role="tab"]').forEach((tab) => {
  tab.addEventListener("click", () => {
    activateLocalTab(tab);
    if (tab.id === "registrations-chart-tab") loadRegistrationActivity();
  });
});
document.querySelector("#activity-granularity").addEventListener("change", loadRegistrationActivity);
document.querySelector(".app-brand").addEventListener("click", (event) => {
  event.preventDefault();
  switchView("registrations");
});
window.addEventListener("hashchange", () => {
  if (session) switchView(location.hash.slice(1), { updateHistory: false });
});
document.querySelector("#registrations").closest("table").querySelector("thead").addEventListener("click", (event) => {
  const button = event.target.closest("[data-sort]");
  if (!button) return;
  const selectedColumn = button.dataset.sort;
  sortAscending = selectedColumn === sortColumn ? !sortAscending : true;
  sortColumn = selectedColumn;
  page = 0;
  loadRegistrations();
});
updateSortHeaders();
document.querySelector("#edition-create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const year = Number(form.elements.year.value);
  const name = form.elements.name.value.trim();
  const button = form.querySelector("button[type=submit]");
  const categoryIds = [...form.querySelectorAll('input[name="categoryIds"]:checked')]
    .map((checkbox) => checkbox.value);
  button.disabled = true;
  try {
    const editionId = await adminRpc("create_edition_with_categories", {
      p_year: year,
      p_name: name,
      p_catalog_category_ids: categoryIds,
    }, session.access_token);
    editionPage = 0;
    await loadEditions();
    document.querySelector("#managed-edition").value = editionId;
    document.querySelector("#settings-edition").value = editionId;
    document.querySelector("#category-edition-select").value = editionId;
    await loadEditionEditor(editionId);
    await loadEditionCategoryPrices(editionId);
    form.reset();
    setMessage("Edicao criada como rascunho e adicionada a lista de edicoes.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#edition-edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const editionId = document.querySelector("#managed-edition").value;
  if (!editionId || !managedEdition) return setMessage("Selecione uma edicao cadastrada para editar.", true);
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const categoryIds = [...form.querySelectorAll('input[name="categoryIds"]:checked')]
      .map((checkbox) => checkbox.value);
    await adminRpc("update_edition_with_categories", {
      p_edition_id: editionId,
      p_year: Number(form.elements.year.value),
      p_name: form.elements.name.value.trim(),
      p_status: form.elements.status.value,
      p_catalog_category_ids: categoryIds,
    }, session.access_token);
    await loadEditions();
    await loadEditionEditor(editionId);
    document.querySelector("#category-edition-select").value = editionId;
    await loadEditionCategoryPrices(editionId);
    setMessage("Edicao atualizada.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const editionId = document.querySelector("#settings-edition").value;
  if (!editionId) return setMessage("Selecione ou crie uma edicao primeiro.", true);
  const whatsappNumber = event.currentTarget.elements.whatsappNumber.value.replace(/\D/g, "");
  if (whatsappNumber && !/^[1-9][0-9]{7,14}$/.test(whatsappNumber)) {
    return setMessage("Informe o WhatsApp com DDI e apenas numeros.", true);
  }
  try {
    await adminWrite("edition_public_settings", { edition_id: `eq.${editionId}` }, "PATCH", {
      whatsapp_number: whatsappNumber,
    }, session.access_token);
    event.currentTarget.elements.whatsappNumber.value = whatsappNumber;
    updateWhatsAppPreview(whatsappNumber);
    setMessage("WhatsApp oficial da edicao salvo.");
  } catch (error) {
    setMessage(error.message, true);
  }
});
document.querySelector("#whatsapp-preview").addEventListener("click", (event) => {
  if (event.currentTarget.hidden) event.preventDefault();
});
document.querySelector("#payment-instructions-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const editionId = document.querySelector("#managed-edition").value;
  if (!editionId) return setMessage("Selecione ou crie uma edicao primeiro.", true);
  try {
    await adminWrite("edition_public_settings", { edition_id: `eq.${editionId}` }, "PATCH", {
      pix_instructions: event.currentTarget.elements.pixInstructions.value.trim(),
    }, session.access_token);
    setMessage("Instrucoes Pix da edicao salvas.");
  } catch (error) {
    setMessage(error.message, true);
  }
});
document.querySelector("#settings-form").elements.whatsappNumber.addEventListener("input", (event) => {
  updateWhatsAppPreview(event.currentTarget.value);
});
document.querySelector("#shirt-settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const editionId = document.querySelector("#managed-edition").value;
  if (!editionId) return setMessage("Selecione ou crie uma edicao primeiro.", true);
  const form = event.currentTarget;
  const options = [...form.querySelectorAll('input[name="shirtOptions"]:checked')]
    .map((option) => option.value);
  const enabled = form.elements.distributeShirt.checked;
  if (enabled && options.length === 0) {
    return setMessage("Marque pelo menos um tamanho de camisa disponivel.", true);
  }
  try {
    await adminRpc("set_edition_shirt_options", {
      p_edition_id: editionId,
      p_distribute_shirt: enabled,
      p_shirt_options: options,
    }, session.access_token);
    setMessage(enabled ? "Camisa habilitada para a inscricao desta edicao." : "Opcao de camisa desativada nesta edicao.");
  } catch (error) {
    setMessage(error.message, true);
  }
});
document.querySelector("#category-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const categoryId = editingCategoryId;
  const minAge = form.elements.minAge.value;
  const maxAge = form.elements.maxAge.value;
  const name = form.elements.name.value.trim();
  const distance = Number(form.elements.distance.value);
  const minAgeValue = minAge ? Number(minAge) : null;
  const maxAgeValue = maxAge ? Number(maxAge) : null;
  const genderRule = form.elements.genderRule.value;
  try {
    if (categoryId) {
      await adminRpc("update_category_catalog", {
        p_category_id: categoryId,
        p_name: name,
        p_distance_km: distance,
        p_min_age: minAgeValue,
        p_max_age: maxAgeValue,
        p_gender_rule: genderRule,
      }, session.access_token);
    } else {
      await adminWrite("category_catalog", {}, "POST", {
        name,
        distance_km: distance,
        min_age: minAgeValue,
        max_age: maxAgeValue,
        gender_rule: genderRule,
      }, session.access_token);
      categoryPage = 0;
    }
    resetCategoryEditor();
    await loadEditions();
    setMessage(categoryId ? "Categoria atualizada." : "Categoria criada.");
  } catch (error) {
    setMessage(error.message, true);
  }
});
document.querySelector("#cancel-category-edit").addEventListener("click", resetCategoryEditor);
document.querySelector("#invite-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    await adminEdgeFunction("admin-invite", { email: form.elements.email.value }, session.access_token);
    form.reset();
    await loadAdmins();
    setMessage("Convite enviado como acesso secundario. A pessoa definira a propria senha pelo link do e-mail.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#copy-status-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(document.querySelector("#new-status-link").value);
    setMessage("Link copiado. Guarde-o e compartilhe somente com o participante.");
  } catch {
    setMessage("Nao foi possivel copiar automaticamente. Selecione e copie o link exibido.", true);
  }
});
document.querySelector("#previous-page").addEventListener("click", () => {
  page = Math.max(0, page - 1);
  loadRegistrations();
});
document.querySelector("#next-page").addEventListener("click", () => {
  page += 1;
  loadRegistrations();
});
document.querySelector("#editions-previous-page").addEventListener("click", () => {
  editionPage = Math.max(0, editionPage - 1);
  loadEditionRows().catch((error) => setMessage(error.message, true));
});
document.querySelector("#editions-next-page").addEventListener("click", () => {
  editionPage += 1;
  loadEditionRows().catch((error) => setMessage(error.message, true));
});
document.querySelector("#categories-previous-page").addEventListener("click", () => {
  categoryPage = Math.max(0, categoryPage - 1);
  loadCategoryCatalog()
    .catch((error) => setMessage(error.message, true));
});
document.querySelector("#categories-next-page").addEventListener("click", () => {
  categoryPage += 1;
  loadCategoryCatalog()
    .catch((error) => setMessage(error.message, true));
});
document.querySelector("#category-prices-previous-page").addEventListener("click", () => {
  categoryPricePage = Math.max(0, categoryPricePage - 1);
  loadEditionCategoryPrices(document.querySelector("#category-edition-select").value)
    .catch((error) => setMessage(error.message, true));
});
document.querySelector("#category-prices-next-page").addEventListener("click", () => {
  categoryPricePage += 1;
  loadEditionCategoryPrices(document.querySelector("#category-edition-select").value)
    .catch((error) => setMessage(error.message, true));
});
document.querySelector("#admins-previous-page").addEventListener("click", () => {
  adminsPage = Math.max(0, adminsPage - 1);
  loadAdmins().catch((error) => setMessage(error.message, true));
});
document.querySelector("#admins-next-page").addEventListener("click", () => {
  adminsPage += 1;
  loadAdmins().catch((error) => setMessage(error.message, true));
});
document.querySelector("#export-csv").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const editionId = document.querySelector("#edition-filter").value;
  if (!["primary", "developer"].includes(role) || !editionId) return;
  button.disabled = true;
  announce(adminMessage, "Preparando exportacao...");
  try {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const batch = await adminRpc("admin_export_page", {
        p_edition_id: editionId,
        p_limit: 500,
        p_offset: offset,
      }, session.access_token);
      rows.push(...batch);
      if (batch.length < 500) break;
    }
    const columns = [
      "registration_number", "full_name", "category_name", "amount_due_cents",
      "payment_status", "registration_status", "created_at",
    ];
    const csv = [
      columns.map(escapeCsv).join(","),
      ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(",")),
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `arame-run-${editionId}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce(adminMessage, `CSV exportado: ${rows.length} inscricoes.`);
  } catch (error) {
    announce(adminMessage, error.message, true);
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#logout-button").addEventListener("click", () => {
  session = null;
  role = null;
  document.body.classList.remove("is-authenticated");
  adminPanel.hidden = true;
  loginCard.hidden = false;
  history.replaceState(null, "", location.pathname);
  document.title = "Administracao | Arame RUN";
});
