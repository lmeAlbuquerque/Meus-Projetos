export function readPublicSupabaseConfig(env) {
  const supabaseUrl = env.SUPABASE_URL?.trim() ?? "";
  const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim() ?? "";

  if (!supabaseUrl && !supabaseAnonKey) {
    return { supabaseUrl: "", supabaseAnonKey: "" };
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must both be configured.");
  }

  let url;
  try {
    url = new URL(supabaseUrl);
  } catch {
    throw new Error("SUPABASE_URL must be a valid Supabase project URL.");
  }

  const hostedSupabase = url.protocol === "https:" &&
    url.hostname.endsWith(".supabase.co");
  const localSupabase = url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.port === "54321";
  if ((!hostedSupabase && !localSupabase) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SUPABASE_URL must be an HTTPS Supabase URL or a local Supabase API URL.");
  }

  if (supabaseAnonKey.startsWith("sb_publishable_")) {
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabaseAnonKey)) {
      throw new Error("SUPABASE_ANON_KEY is not a valid publishable key.");
    }
  } else {
    const parts = supabaseAnonKey.split(".");
    let payload;
    try {
      if (parts.length !== 3) throw new Error();
      payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      throw new Error("SUPABASE_ANON_KEY must be a publishable key or an anon JWT.");
    }
    if (payload.role !== "anon") {
      throw new Error("SUPABASE_ANON_KEY must have the anon role; never use a service-role or secret key.");
    }
  }

  return { supabaseUrl: url.origin, supabaseAnonKey };
}

export function publicConfigScript(config) {
  return `window.ARAME_RUN_CONFIG = ${JSON.stringify(config)};\n`;
}
