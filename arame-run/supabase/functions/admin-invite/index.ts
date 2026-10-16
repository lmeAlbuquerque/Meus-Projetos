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

  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.match(/^Bearer ([^\s]+)$/)?.[1];
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!accessToken || !supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: "Sessao ou configuracao indisponivel." }, 401, origin);
  }

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corpo JSON invalido." }, 400, origin);
  }
  if (typeof body.email !== "string" ||
      !/^[^@\s]{1,128}@[^@\s.]{1,128}(?:\.[^@\s.]{1,63})+$/.test(body.email) ||
      body.email.length > 254) {
    return json({ error: "Informe um e-mail valido." }, 400, origin);
  }

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
  });
  if (!userResponse.ok) return json({ error: "Sessao expirada. Entre novamente." }, 401, origin);
  const user = await userResponse.json();

  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/admin_profiles?user_id=eq.${encodeURIComponent(user.id)}&role=in.(primary,developer)&is_active=eq.true&select=user_id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  if (!profileResponse.ok) {
    console.error("Primary administrator validation failed", profileResponse.status);
    return json({ error: "Nao foi possivel verificar a permissao." }, 502, origin);
  }
  if (!(await profileResponse.json()).length) {
    return json({ error: "Somente administradores autorizados podem convidar usuarios." }, 403, origin);
  }

  const inviteResponse = await fetch(`${supabaseUrl}/auth/v1/invite`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: body.email.trim().toLowerCase(),
      redirect_to: `${origin}/admin.html`,
    }),
  });
  if (!inviteResponse.ok) {
    if (inviteResponse.status === 422 || inviteResponse.status === 409) {
      return json({ error: "O e-mail ja possui uma conta ou nao pode ser convidado." }, 409, origin);
    }
    console.error("Admin invite request failed", inviteResponse.status);
    return json({ error: "Convite nao enviado. Verifique Auth e a configuracao de e-mail." }, 502, origin);
  }

  const invitedUser = await inviteResponse.json();
  const profileInsert = await fetch(`${supabaseUrl}/rest/v1/admin_profiles`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      user_id: invitedUser.id,
      email: body.email.trim().toLowerCase(),
      role: "read_only",
      is_active: true,
      created_by: user.id,
    }),
  });
  if (!profileInsert.ok) {
    console.error("Admin profile creation failed after invite", profileInsert.status);
    return json({
      error: "O convite foi enviado, mas o perfil somente-leitura nao foi criado. Desative a conta convidada no Auth e contate o administrador.",
    }, 502, origin);
  }
  return json({ invited: true }, 201, origin);
});
