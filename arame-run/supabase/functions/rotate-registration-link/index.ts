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

Deno.serve(async (request: Request) => {
  const origin = Deno.env.get("ALLOWED_ORIGIN") ?? "";
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (!origin || request.headers.get("origin") !== origin) {
    return json({ error: "Origem nao autorizada." }, 403, origin || "null");
  }
  if (request.method !== "POST") return json({ error: "Metodo nao permitido." }, 405, origin);

  const accessToken = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!accessToken || !supabaseUrl || !anonKey) {
    return json({ error: "Sessao ou configuracao indisponivel." }, 401, origin);
  }

  let body: { registrationId?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corpo JSON invalido." }, 400, origin);
  }
  if (typeof body.registrationId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(body.registrationId)) {
    return json({ error: "Inscricao invalida." }, 400, origin);
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    return json({ error: "Servico temporariamente indisponivel." }, 503, origin);
  }
  const token = createRegistrationToken();
  const tokenHash = await hashRegistrationToken(token);
  const encryptedToken = await encryptRegistrationToken(token, serviceKey);
  const rotateResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/rotate_registration_lookup_token_with_ciphertext`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_registration_id: body.registrationId,
      p_new_token_hash_hex: tokenHash,
      p_token_ciphertext: encryptedToken,
    }),
  });
  if (!rotateResponse.ok) {
    if (rotateResponse.status === 401 || rotateResponse.status === 403) {
      return json({ error: "Somente a administradora principal ou o DEV pode renovar este link." }, 403, origin);
    }
    if (rotateResponse.status === 404 || rotateResponse.status === 406) {
      return json({ error: "Inscricao ativa nao encontrada." }, 404, origin);
    }
    console.error("Registration link rotation failed", rotateResponse.status);
    return json({ error: "Nao foi possivel renovar o link." }, 502, origin);
  }
  return json({ statusUrl: `${origin}/status.html#${token}` }, 200, origin);
});
