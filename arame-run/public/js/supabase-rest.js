function config() {
  const value = window.ARAME_RUN_CONFIG;
  if (!value?.supabaseUrl || !value?.supabaseAnonKey ||
      value.supabaseUrl.includes("SEU-PROJETO") ||
      value.supabaseAnonKey.includes("CHAVE_ANON")) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_ANON_KEY no arquivo .env e reinicie o servidor local.");
  }
  return value;
}

async function request(path, { method = "GET", body, token, headers = {}, includeHeaders = false } = {}) {
  const settings = config();
  const response = await fetch(`${settings.supabaseUrl}${path}`, {
    method,
    headers: {
      apikey: settings.supabaseAnonKey,
      Authorization: `Bearer ${token ?? settings.supabaseAnonKey}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(includeHeaders ? { Prefer: "count=exact" } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.msg ?? payload?.message ?? payload?.error_description ?? payload?.message ?? "Falha ao consultar o servico.");
  if (includeHeaders) {
    return { payload, contentRange: response.headers.get("content-range") };
  }
  return payload;
}

export async function select(table, query = {}) {
  return request(`/rest/v1/${table}?${new URLSearchParams(query)}`);
}

export async function edgeFunction(name, body) {
  return request(`/functions/v1/${name}`, { method: "POST", body });
}

export async function signIn(email, password) {
  return request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
}

export async function getProfile(token, userId) {
  const rows = await request(`/rest/v1/admin_profiles?user_id=eq.${encodeURIComponent(userId)}&select=role,is_active`, { token });
  return rows[0] ?? null;
}

export async function adminSelect(table, query, token) {
  return request(`/rest/v1/${table}?${new URLSearchParams(query)}`, { token });
}

export async function adminSelectPage(table, query, token) {
  const result = await request(`/rest/v1/${table}?${new URLSearchParams(query)}`, {
    token,
    includeHeaders: true,
  });
  const total = Number(result.contentRange?.split("/")[1]);
  if (!Number.isFinite(total)) {
    throw new Error("Nao foi possivel determinar o total de registros para a paginacao.");
  }
  return { rows: result.payload, total };
}

export async function adminRpc(name, body, token) {
  return request(`/rest/v1/rpc/${name}`, { method: "POST", body, token });
}

export async function adminWrite(table, query, method, body, token) {
  return request(`/rest/v1/${table}${query ? `?${new URLSearchParams(query)}` : ""}`, {
    method,
    body,
    token,
    headers: { Prefer: "return=representation" },
  });
}

export async function adminEdgeFunction(name, body, token) {
  return request(`/functions/v1/${name}`, { method: "POST", body, token });
}
