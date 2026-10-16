import test from "node:test";
import assert from "node:assert/strict";
import { buildWhatsAppUrl, escapeCsv, validateRegistration } from "../../public/js/core.js";
import { publicConfigScript, readPublicSupabaseConfig } from "../../scripts/public-config.mjs";

const validRegistration = {
  fullName: "Pessoa de Teste",
  phone: "+5511999999999",
  birthDate: "1990-01-01",
  gender: "female",
  editionId: "edition-id",
  categoryId: "category-id",
  shirtSize: "M",
};

test("validates the required registration data", () => {
  assert.deepEqual(validateRegistration(validRegistration), []);
  assert.ok(validateRegistration({ ...validRegistration, phone: "123" }).length > 0);
  assert.ok(validateRegistration({ ...validRegistration, birthDate: "invalid" }).length > 0);
  assert.ok(validateRegistration({ ...validRegistration, birthDate: "1990-02-30" }).length > 0);
  assert.ok(validateRegistration({ ...validRegistration, gender: "other" }).length > 0);
});

test("encodes WhatsApp text and rejects invalid numbers", () => {
  const url = new URL(buildWhatsAppUrl("5511999999999", "Arame RUN 2026", 21, "Pessoa Teste"));
  assert.equal(url.hostname, "wa.me");
  assert.equal(url.pathname, "/5511999999999");
  assert.match(url.searchParams.get("text"), /Arame RUN 2026/);
  assert.match(url.searchParams.get("text"), /21/);
  assert.throws(() => buildWhatsAppUrl("invalid", "Evento", 1, "Pessoa"));
});

test("quotes CSV fields including delimiters and quotes", () => {
  assert.equal(escapeCsv('Nome, "Teste"'), '"Nome, ""Teste"""');
  assert.equal(escapeCsv("=1+1"), "\"'=1+1\"");
});

test("public Supabase configuration accepts anon and publishable keys only", () => {
  const publishable = readPublicSupabaseConfig({
    SUPABASE_URL: "https://arame-test.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_testKey_123",
    SUPABASE_SERVICE_ROLE_KEY: "must-not-be-exposed",
  });
  assert.deepEqual(publishable, {
    supabaseUrl: "https://arame-test.supabase.co",
    supabaseAnonKey: "sb_publishable_testKey_123",
  });
  const script = publicConfigScript(publishable);
  assert.match(script, /sb_publishable_testKey_123/);
  assert.doesNotMatch(script, /must-not-be-exposed|SUPABASE_SERVICE_ROLE_KEY/);
});

test("public Supabase configuration accepts only legacy anon JWTs", () => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const anonJwt = `${encode({ alg: "HS256" })}.${encode({ role: "anon" })}.signature`;
  assert.equal(readPublicSupabaseConfig({
    SUPABASE_URL: "https://arame-test.supabase.co/",
    SUPABASE_ANON_KEY: anonJwt,
  }).supabaseAnonKey, anonJwt);

  const serviceJwt = `${encode({ alg: "HS256" })}.${encode({ role: "service_role" })}.signature`;
  assert.throws(
    () => readPublicSupabaseConfig({
      SUPABASE_URL: "https://arame-test.supabase.co",
      SUPABASE_ANON_KEY: serviceJwt,
    }),
    /must have the anon role/,
  );
});

test("public Supabase configuration rejects incomplete or unsafe values", () => {
  assert.deepEqual(readPublicSupabaseConfig({}), {
    supabaseUrl: "",
    supabaseAnonKey: "",
  });
  assert.throws(
    () => readPublicSupabaseConfig({ SUPABASE_URL: "https://arame-test.supabase.co" }),
    /must both be configured/,
  );
  assert.throws(
    () => readPublicSupabaseConfig({
      SUPABASE_URL: "https://example.com",
      SUPABASE_ANON_KEY: "sb_publishable_testKey_123",
    }),
    /HTTPS Supabase URL/,
  );
});
