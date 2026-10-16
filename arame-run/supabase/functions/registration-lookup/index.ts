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

Deno.serve(async (request: Request) => {
  const origin = Deno.env.get("ALLOWED_ORIGIN") ?? "";
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (request.headers.get("origin") !== origin || !origin) {
    return json({ error: "Origem nao autorizada." }, 403, origin || "null");
  }
  if (request.method !== "POST") return json({ error: "Metodo nao permitido." }, 405, origin);
  if (Number(request.headers.get("content-length") ?? 0) > 1024) {
    return json({ error: "Requisicao muito grande." }, 413, origin);
  }

  let token: unknown;
  try {
    token = (await request.json()).token;
  } catch {
    return json({ error: "Link invalido." }, 400, origin);
  }
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    return json({ error: "Link invalido ou expirado." }, 404, origin);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rateLimitSecret = Deno.env.get("RATE_LIMIT_SECRET");
  if (!supabaseUrl || !serviceKey || !rateLimitSecret || rateLimitSecret.length < 32) {
    return json({ error: "Servico indisponivel." }, 503, origin);
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
    new TextEncoder().encode(`lookup:${clientIp}`),
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
    body: JSON.stringify({ p_fingerprint_hex: fingerprint, p_max_attempts: 60 }),
  });
  if (!rateLimitResponse.ok) {
    console.error("Lookup rate-limit check failed", rateLimitResponse.status);
    return json({ error: "Servico temporariamente indisponivel." }, 503, origin);
  }
  if (await rateLimitResponse.json() !== true) {
    return json({ error: "Muitas consultas desta rede. Tente novamente mais tarde." }, 429, origin);
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/lookup_registration`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_token_hash_hex: tokenHash }),
  });
  if (!response.ok) {
    console.error("Registration lookup RPC failed", response.status);
    return json({ error: "Nao foi possivel consultar a inscricao." }, 502, origin);
  }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) {
    return json({ error: "Link invalido ou inscricao indisponivel." }, 404, origin);
  }
  return json(rows[0], 200, origin);
});
