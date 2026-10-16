import { buildWhatsAppUrl } from "./core.js";
import { edgeFunction } from "./supabase-rest.js";
import { loadTheme } from "./theme.js";

const message = document.querySelector("#status-message");
const details = document.querySelector("#registration-details");

function addDetail(label, value) {
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  document.querySelector("#details-list").append(term, description);
}

async function loadStatus() {
  const token = location.hash.slice(1);
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("Este link esta incompleto ou invalido.");
  const record = await edgeFunction("registration-lookup", { token });
  const nameParts = record.participant_name.trim().split(/\s+/);
  const privateDisplayName = nameParts.length > 1
    ? `${nameParts[0]} ${nameParts[1][0]}.`
    : nameParts[0];
  addDetail("Evento", record.edition_name);
  addDetail("Inscricao", String(record.registration_number));
  addDetail("Participante", privateDisplayName);
  addDetail("Categoria", record.category_name);
  addDetail("Pagamento", {
    pending: "Pendente de confirmacao manual",
    confirmed: "Confirmado",
    refunded: "Estornado",
  }[record.payment_status] ?? "Indisponivel");
  if (record.payment_confirmed_at) {
    addDetail("Confirmado em", new Date(record.payment_confirmed_at).toLocaleString("pt-BR"));
  }
  document.querySelector("#payment-note").textContent = record.payment_status === "confirmed"
    ? "Pagamento conferido pela organizacao."
    : "O pagamento sera confirmado pela organizacao apos conferencia externa.";
  document.querySelector("#pix-instructions").textContent = record.pix_instructions;
  const announcements = document.querySelector("#announcements");
  if (record.announcement_url) {
    announcements.href = record.announcement_url;
    announcements.hidden = false;
  }
  const wa = document.querySelector("#whatsapp");
  if (record.whatsapp_number) {
    wa.href = buildWhatsAppUrl(record.whatsapp_number, record.edition_name,
      record.registration_number, record.participant_name);
    wa.hidden = false;
  }
  details.hidden = false;
  message.textContent = "Inscricao localizada.";
}

loadStatus().catch((error) => {
  message.textContent = error.message;
  message.classList.add("error");
});
loadTheme();
