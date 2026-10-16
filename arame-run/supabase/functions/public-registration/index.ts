import {
  encryptRegistrationToken,
  hashRegistrationToken,
  createRegistrationToken,
} from "../_shared/registration-link-crypto.ts";

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

const json = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });

function isValidInput(input: Record<string, unknown>): boolean {
  return typeof input.editionId === "string" &&
    /^[0-9a-f-]{36}$/i.test(input.editionId) &&
    typeof input.categoryId === "string" &&
    /^[0-9a-f-]{36}$/i.test(input.categoryId) &&
    typeof input.fullName === "string" &&
    input.fullName.trim().length >= 2 &&
    input.fullName.trim().length <= 160 &&
    typeof input.phone === "string" &&
    /^\+[1-9][0-9]{7,14}$/.test(input.phone) &&
    typeof input.birthDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) &&
    !Number.isNaN(Date.parse(`${input.birthDate}T00:00:00Z`)) &&
    new Date(`${input.birthDate}T00:00:00Z`).toISOString().slice(0, 10) === input.birthDate &&
    typeof input.gender === "string" &&
    ["female", "male"].includes(input.gender) &&
    typeof input.shirtSize === "string" && input.shirtSize.length <= 20;
}

Deno.serve(async (request: Request) => {
  const origin = Deno.env.get("ALLOWED_ORIGIN") ?? "";
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (request.headers.get("origin") !== origin || !origin) {
    return json({ error: "Origem nao autorizada." }, 403, origin || "null");
  }
  if (request.method !== "POST") return json({ error: "Metodo nao permitido." }, 405, origin);
  if (Number(request.headers.get("content-length") ?? 0) > 16384) {
    return json({ error: "Requisicao muito grande." }, 413, origin);
  }

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Corpo JSON invalido." }, 400, origin);
  }
  if (!input || !isValidInput(input)) {
    return json({ error: "Confira os campos obrigatorios da inscricao." }, 400, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rateLimitSecret = Deno.env.get("RATE_LIMIT_SECRET");
  if (!supabaseUrl || !serviceKey || !rateLimitSecret || rateLimitSecret.length < 32) {
    return json({ error: "Servico temporariamente indisponivel." }, 503, origin);
  }

  const clientIp = request.headers.get("cf-connecting-ip");
  if (!clientIp || clientIp.length > 64) {
    return json({ error: "Nao foi possivel validar esta requisicao." }, 503, origin);
  }
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(rateLimitSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const fingerprintBytes = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    new TextEncoder().encode(`signup:${clientIp}`),
  );
  const fingerprint = Array.from(new Uint8Array(fingerprintBytes),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
  const rateLimitResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_public_rate_limit`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_fingerprint_hex: fingerprint, p_max_attempts: 5 }),
  });
  if (!rateLimitResponse.ok) {
    console.error("Signup rate-limit check failed", rateLimitResponse.status);
    return json({ error: "Servico temporariamente indisponivel." }, 503, origin);
  }
  if (await rateLimitResponse.json() !== true) {
    return json({ error: "Muitas tentativas desta rede. Tente novamente mais tarde." }, 429, origin);
  }

  const token = createRegistrationToken();
  const tokenHash = await hashRegistrationToken(token);
  const encryptedToken = await encryptRegistrationToken(token, serviceKey);

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/create_registration_with_private_link`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_edition_id: input.editionId,
      p_category_id: input.categoryId,
      p_full_name: input.fullName.trim(),
      p_phone_e164: input.phone,
      p_birth_date: input.birthDate,
      p_gender: input.gender,
      p_shirt_size: input.shirtSize,
      p_token_hash_hex: tokenHash,
      p_token_ciphertext: encryptedToken,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    if (response.status === 409 || details.includes("Duplicate active registration")) {
      return json({ error: "Ja existe uma inscricao ativa com estes dados nesta edicao." }, 409, origin);
    }
    if (response.status === 400) {
      return json({ error: "A inscricao nao foi aceita. Confira categoria, idade e vagas." }, 400, origin);
    }
    console.error("Registration RPC failed", response.status);
    return json({ error: "Nao foi possivel concluir a inscricao. Tente novamente." }, 502, origin);
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) {
    console.error("Registration RPC returned an unexpected result");
    return json({ error: "Nao foi possivel confirmar a inscricao." }, 502, origin);
  }
  return json({
    registrationId: rows[0].registration_id,
    registrationNumber: rows[0].registration_number,
    editionName: rows[0].edition_name,
    statusUrl: `${origin}/status.html#${token}`,
  }, 201, origin);
});
