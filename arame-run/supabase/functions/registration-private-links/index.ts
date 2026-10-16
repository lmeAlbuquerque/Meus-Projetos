import { decryptRegistrationToken } from "../_shared/registration-link-crypto.ts";

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
  if (Number(request.headers.get("content-length") ?? 0) > 16384) {
    return json({ error: "Requisicao muito grande." }, 413, origin);
  }

  const accessToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!accessToken || !supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: "Sessao ou configuracao indisponivel." }, 401, origin);
  }

  let body: { registrationIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corpo JSON invalido." }, 400, origin);
  }
  if (!Array.isArray(body.registrationIds) || body.registrationIds.length > 50 ||
      body.registrationIds.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) {
    return json({ error: "Lista de inscricoes invalida." }, 400, origin);
  }
  const registrationIds = [...new Set(body.registrationIds as string[])];
  if (registrationIds.length !== body.registrationIds.length) {
    return json({ error: "A lista contem inscricoes repetidas." }, 400, origin);
  }

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
  });
  if (!userResponse.ok) return json({ error: "Sessao administrativa invalida." }, 401, origin);
  const user = await userResponse.json();
  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/admin_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=role,is_active`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  if (!profileResponse.ok) {
    console.error("Registration link profile lookup failed", profileResponse.status);
    return json({ error: "Nao foi possivel validar a permissao administrativa." }, 502, origin);
  }
  const profiles = await profileResponse.json();
  const profile = profiles[0];
  if (!profile?.is_active || !["primary", "developer", "read_only"].includes(profile.role)) {
    return json({ error: "Conta sem permissao administrativa ativa." }, 403, origin);
  }

  if (registrationIds.length === 0) return json({ links: [] }, 200, origin);
  const idFilter = `in.(${registrationIds.map(encodeURIComponent).join(",")})`;
  const registrationsResponse = await fetch(
    `${supabaseUrl}/rest/v1/registrations?id=${idFilter}&select=id`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` } },
  );
  if (!registrationsResponse.ok) {
    console.error("Registration links lookup failed", registrationsResponse.status);
    return json({ error: "Nao foi possivel carregar os links privados." }, 502, origin);
  }
  const registrations = await registrationsResponse.json();
  if (registrations.length !== registrationIds.length) {
    return json({ error: "Uma ou mais inscricoes nao foram encontradas." }, 404, origin);
  }
  const secretsResponse = await fetch(
    `${supabaseUrl}/rest/v1/registration_private_links?registration_id=${idFilter}&select=registration_id,token_ciphertext`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  if (!secretsResponse.ok) {
    console.error("Encrypted registration links lookup failed", secretsResponse.status);
    return json({ error: "Nao foi possivel carregar os links privados." }, 502, origin);
  }
  const canViewLink = ["primary", "developer"].includes(profile.role);
  const secrets = await secretsResponse.json();
  const secretMap = new Map<string, string>();
  for (const secret of secrets as Array<{ registration_id: string; token_ciphertext: string }>) {
    secretMap.set(secret.registration_id, canViewLink
      ? await decryptRegistrationToken(secret.token_ciphertext, serviceKey)
      : "");
  }
  return json({
    links: registrations.map((registration: { id: string }) => {
      const token = secretMap.get(registration.id);
      return {
        registrationId: registration.id,
        available: token !== undefined,
        ...(canViewLink && token
          ? { statusUrl: `${origin}/status.html#${token}` }
          : {}),
      };
    }),
  }, 200, origin);
});
