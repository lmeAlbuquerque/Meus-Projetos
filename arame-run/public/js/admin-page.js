import { escapeCsv } from "./core.js";
import {
  adminEdgeFunction,
  adminRpc,
  adminSelect,
  adminWrite,
  getProfile,
  signIn,
} from "./supabase-rest.js";
import { applyTheme, loadTheme } from "./theme.js";

const loginCard = document.querySelector("#login-card");
const adminPanel = document.querySelector("#admin-panel");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const adminMessage = document.querySelector("#admin-message");
const rowsElement = document.querySelector("#registrations");
const managementMessage = document.querySelector("#management-message");
const pageSize = 50;
let page = 0;
let session = null;
let role = null;
let sortColumn = "registration_number";
let sortAscending = true;
let searchTimer = null;
let currentShirtSettings = { distribute_shirt: false, shirt_options: [] };

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

function switchView(viewName) {
  for (const panel of document.querySelectorAll("[data-view-panel]")) {
    panel.hidden = panel.dataset.viewPanel !== viewName;
  }
  for (const button of document.querySelectorAll("#module-nav [data-view]")) {
    const selected = button.dataset.view === viewName;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-current", selected ? "page" : "false");
  }
}

async function loadEditions() {
  const editions = await adminSelect("editions",
    { select: "id,name,year,status", order: "year.desc" }, session.access_token);
  const select = document.querySelector("#edition-filter");
  select.replaceChildren(new Option("Selecione", ""));
  for (const edition of editions) select.add(new Option(`${edition.name} (${edition.year})`, edition.id));
  const managed = document.querySelector("#managed-edition");
  managed.replaceChildren(new Option("Nova edicao", ""));
  const settingsEdition = document.querySelector("#settings-edition");
  settingsEdition.replaceChildren(new Option("Selecione uma edicao", ""));
  for (const edition of editions) {
    const label = `${edition.name} (${edition.year})`;
    managed.add(new Option(label, edition.id));
    settingsEdition.add(new Option(label, edition.id));
  }
  select.onchange = () => {
    page = 0;
    loadReport();
    loadRegistrations();
    if (["primary", "developer"].includes(role)) {
      managed.value = select.value;
      settingsEdition.value = select.value;
      Promise.all([
        loadEditionEditor(select.value, editions),
        loadCategoryEditorChoices(select.value),
      ]).catch((error) => setMessage(error.message, true));
    }
  };
  managed.onchange = () => Promise.all([
    loadEditionEditor(managed.value, editions),
    loadCategoryEditorChoices(managed.value),
  ]).catch((error) => setMessage(error.message, true));
  settingsEdition.onchange = () => {
    managed.value = settingsEdition.value;
    Promise.all([
      loadEditionEditor(settingsEdition.value, editions),
      loadCategoryEditorChoices(settingsEdition.value),
    ]).catch((error) => setMessage(error.message, true));
  };
  document.querySelector("#clone-form").hidden = !["primary", "developer"].includes(role);
}

function setMessage(text, isError = false) {
  announce(managementMessage, text, isError);
}

function updateWhatsAppPreview(number) {
  const link = document.querySelector("#whatsapp-preview");
  const normalized = String(number ?? "").replace(/\D/g, "");
  link.hidden = !/^[1-9][0-9]{7,14}$/.test(normalized);
  link.href = link.hidden ? "#" : `https://wa.me/${normalized}`;
}

async function loadEditionEditor(editionId, knownEditions = null) {
  const form = document.querySelector("#edition-form");
  const editions = knownEditions ?? await adminSelect("editions", {
    select: "id,name,year,status",
    id: `eq.${editionId}`,
  }, session.access_token);
  const edition = editions.find((item) => item.id === editionId);
  const button = document.querySelector("#save-edition");
  if (!editionId || !edition) {
    form.elements.year.value = "";
    form.elements.name.value = "";
    form.elements.status.value = "draft";
    button.textContent = "Criar edicao";
    const settings = document.querySelector("#settings-form");
    settings.reset();
    settings.elements.edition.value = "";
    document.querySelector("#whatsapp-preview").hidden = true;
    document.querySelector("#payment-instructions-form").reset();
    currentShirtSettings = { distribute_shirt: false, shirt_options: [] };
    document.querySelector("#shirt-settings-form").reset();
    return;
  }
  form.elements.year.value = edition.year;
  form.elements.name.value = edition.name;
  form.elements.status.value = edition.status;
  button.textContent = "Salvar edicao";
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
  currentShirtSettings = {
    distribute_shirt: record.distribute_shirt === true,
    shirt_options: record.shirt_options ?? [],
  };
  shirtForm.elements.distributeShirt.checked = currentShirtSettings.distribute_shirt;
  for (const option of shirtForm.elements.shirtOptions.options) {
    option.selected = currentShirtSettings.shirt_options.includes(option.value);
  }
  updateWhatsAppPreview(record.whatsapp_number ?? "");
}

async function loadCategoryEditorChoices(editionId) {
  const form = document.querySelector("#category-form");
  const select = form.elements.categoryToEdit;
  form.reset();
  select.replaceChildren(new Option("Nova categoria", ""));
  const saveButton = document.querySelector("#save-category");
  saveButton.textContent = "Adicionar categoria";
  if (!editionId) return;
  const categories = await adminSelect("categories", {
    select: "id,name,distance_km,min_age,max_age,gender_rule,price_cents,capacity,is_active",
    edition_id: `eq.${editionId}`,
    order: "name.asc",
  }, session.access_token);
  for (const category of categories) select.add(new Option(category.name, category.id));
}

async function loadAdmins() {
  const admins = await adminSelect("admin_profiles", {
    select: "user_id,email,role,is_active,created_at,created_by",
    order: "created_at.asc",
  }, session.access_token);
  const body = document.querySelector("#admins");
  body.replaceChildren();
  const principal = admins.find((admin) => admin.role === "primary");
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
  try {
    session = await signIn(data.email, data.password);
    const profile = await getProfile(session.access_token, session.user.id);
    if (!profile?.is_active) throw new Error("Conta sem permissao administrativa ativa.");
    role = profile.role;
    loginCard.hidden = true;
    adminPanel.hidden = false;
    const isManager = ["primary", "developer"].includes(role);
    document.querySelector("#admin-role").textContent = {
      developer: "DEV — acesso tecnico global",
      primary: "Administradora principal",
      read_only: "Administradora secundaria — somente leitura",
    }[role];
    document.querySelector("#module-nav").hidden = !isManager;
    document.querySelector("#export-csv").hidden = !isManager;
    switchView("registrations");
    await loadTheme();
    document.querySelector("#theme-form").elements.theme.value =
      document.documentElement.dataset.theme ?? "arame";
    await loadEditions();
    if (isManager) await loadAdmins();
  } catch (error) {
    session = null;
    role = null;
    adminPanel.hidden = true;
    loginCard.hidden = false;
    announce(loginMessage, error.message, true);
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
  if (button) switchView(button.dataset.view);
});
document.querySelector("#category-editor-select").addEventListener("change", async (event) => {
  const categoryId = event.currentTarget.value;
  const form = document.querySelector("#category-form");
  if (!categoryId) {
    form.reset();
    document.querySelector("#save-category").textContent = "Adicionar categoria";
    return;
  }
  try {
    const categories = await adminSelect("categories", {
      select: "id,name,distance_km,min_age,max_age,gender_rule,price_cents,capacity,is_active",
      id: `eq.${categoryId}`,
    }, session.access_token);
    const category = categories[0];
    if (!category) throw new Error("Categoria nao encontrada.");
    form.elements.name.value = category.name;
    form.elements.distance.value = category.distance_km;
    form.elements.minAge.value = category.min_age ?? "";
    form.elements.maxAge.value = category.max_age ?? "";
    form.elements.genderRule.value = category.gender_rule;
    form.elements.price.value = (category.price_cents / 100).toFixed(2);
    form.elements.capacity.value = category.capacity ?? "";
    form.elements.active.value = String(category.is_active);
    document.querySelector("#save-category").textContent = "Salvar categoria";
  } catch (error) {
    setMessage(error.message, true);
  }
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
document.querySelector("#managed-edition").addEventListener("change", async (event) => {
  const editionId = event.currentTarget.value;
  const filter = document.querySelector("#edition-filter");
  filter.value = editionId;
  page = 0;
  if (editionId) {
    await loadEditionEditor(editionId);
    await loadReport();
    await loadRegistrations();
  } else {
    await loadEditionEditor("");
  }
});
document.querySelector("#edition-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const editionId = document.querySelector("#managed-edition").value;
  const year = Number(form.elements.year.value);
  const name = form.elements.name.value.trim();
  const status = form.elements.status.value;
  const button = document.querySelector("#save-edition");
  button.disabled = true;
  try {
    if (editionId) {
      await adminWrite("editions", { id: `eq.${editionId}` }, "PATCH", {
        year, name, status,
      }, session.access_token);
      setMessage("Edicao atualizada.");
    } else {
      await adminRpc("create_edition", { p_year: year, p_name: name }, session.access_token);
      setMessage("Edicao criada.");
    }
    await loadEditions();
    const editions = await adminSelect("editions", {
      select: "id,name,year,status", order: "year.desc",
    }, session.access_token);
    const saved = editions.find((edition) => edition.year === year);
    if (saved) {
      document.querySelector("#managed-edition").value = saved.id;
      document.querySelector("#edition-filter").value = saved.id;
      await loadEditionEditor(saved.id, editions);
      await loadCategoryEditorChoices(saved.id);
      await loadReport();
      await loadRegistrations();
    }
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#clone-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const sourceEditionId = document.querySelector("#managed-edition").value;
  if (!sourceEditionId) return setMessage("Selecione uma edicao de origem.", true);
  const form = event.currentTarget;
  const year = Number(form.elements.year.value);
  const name = form.elements.name.value.trim();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    await adminRpc("clone_edition", {
      p_source_edition_id: sourceEditionId,
      p_year: year,
      p_name: name,
    }, session.access_token);
    await loadEditions();
    const editions = await adminSelect("editions", {
      select: "id,name,year,status", order: "year.desc",
    }, session.access_token);
    const created = editions.find((edition) => edition.year === year);
    if (created) {
      document.querySelector("#managed-edition").value = created.id;
      document.querySelector("#edition-filter").value = created.id;
      await loadEditionEditor(created.id, editions);
      await loadCategoryEditorChoices(created.id);
      await loadReport();
      await loadRegistrations();
    }
    form.reset();
    setMessage("Nova edicao criada como rascunho, sem inscritos nem pagamentos.");
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
  const options = [...form.elements.shirtOptions.selectedOptions].map((option) => option.value);
  const enabled = form.elements.distributeShirt.checked;
  try {
    await adminRpc("set_edition_shirt_options", {
      p_edition_id: editionId,
      p_distribute_shirt: enabled,
      p_shirt_options: options,
    }, session.access_token);
    currentShirtSettings = {
      distribute_shirt: enabled,
      shirt_options: enabled ? options : [],
    };
    setMessage(enabled ? "Camisa habilitada para a inscricao desta edicao." : "Opcao de camisa desativada nesta edicao.");
  } catch (error) {
    setMessage(error.message, true);
  }
});
document.querySelector("#category-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const editionId = document.querySelector("#managed-edition").value;
  if (!editionId) return setMessage("Selecione ou crie uma edicao primeiro.", true);
  const form = event.currentTarget;
  const categoryId = form.elements.categoryToEdit.value;
  const minAge = form.elements.minAge.value;
  const maxAge = form.elements.maxAge.value;
  const data = {
    edition_id: editionId,
    name: form.elements.name.value.trim(),
    distance_km: Number(form.elements.distance.value),
    min_age: minAge ? Number(minAge) : null,
    max_age: maxAge ? Number(maxAge) : null,
    gender_rule: form.elements.genderRule.value,
    price_cents: Math.round(Number(form.elements.price.value) * 100),
    capacity: form.elements.capacity.value ? Number(form.elements.capacity.value) : null,
    shirt_options: currentShirtSettings.distribute_shirt ? currentShirtSettings.shirt_options : [],
    is_active: form.elements.active.value === "true",
  };
  try {
    if (categoryId) {
      await adminWrite("categories", { id: `eq.${categoryId}` }, "PATCH", data, session.access_token);
    } else {
      await adminWrite("categories", {}, "POST", data, session.access_token);
    }
    await loadCategoryEditorChoices(editionId);
    setMessage(categoryId ? "Categoria atualizada." : "Categoria criada.");
  } catch (error) {
    setMessage(error.message, true);
  }
});
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
document.querySelector("#theme-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const theme = event.currentTarget.elements.theme.value;
  const previousTheme = document.documentElement.dataset.theme ?? "arame";
  try {
    applyTheme(theme);
    await adminWrite("app_theme_settings", { singleton: "eq.true" }, "PATCH", {
      theme,
    }, session.access_token);
    setMessage("Tema atualizado para todos os visitantes.");
  } catch (error) {
    applyTheme(previousTheme);
    setMessage(error.message, true);
  }
});
document.querySelector("#theme-form").elements.theme.addEventListener("change", (event) => {
  applyTheme(event.currentTarget.value);
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
  adminPanel.hidden = true;
  loginCard.hidden = false;
});
