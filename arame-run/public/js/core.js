export function buildWhatsAppUrl(number, eventName, registrationNumber, participantName) {
  const digits = String(number ?? "").replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error("Numero de WhatsApp invalido.");
  const message = `Ola! Envio o comprovante da inscricao ${eventName}.\nNumero: ${registrationNumber}\nParticipante: ${participantName}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function validateRegistration(data) {
  const problems = [];
  if (!data.fullName || data.fullName.trim().length < 2 || data.fullName.trim().length > 160) {
    problems.push("Informe o nome completo.");
  }
  if (!/^\+[1-9]\d{7,14}$/.test(data.phone ?? "")) problems.push("Informe o telefone com codigo do pais.");
  const parsedBirthDate = new Date(`${data.birthDate}T00:00:00Z`);
  const validCalendarDate = /^\d{4}-\d{2}-\d{2}$/.test(data.birthDate ?? "") &&
    !Number.isNaN(parsedBirthDate.getTime()) &&
    parsedBirthDate.toISOString().slice(0, 10) === data.birthDate;
  if (!validCalendarDate || parsedBirthDate > new Date()) {
    problems.push("Informe uma data de nascimento valida.");
  }
  if (!["female", "male"].includes(data.gender)) {
    problems.push("Selecione uma opcao de sexo.");
  }
  if (!data.editionId || !data.categoryId || typeof data.shirtSize !== "string") {
    problems.push("Selecione edicao, categoria e tamanho da camisa.");
  }
  return problems;
}

export function escapeCsv(value) {
  const text = String(value ?? "");
  const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}
