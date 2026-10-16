import test from "node:test";
import assert from "node:assert/strict";

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const editionId = process.env.ARAME_RUN_TEST_EDITION_ID;
const separateEditionId = "27000000-0000-4000-8000-000000000027";
const primaryToken = process.env.ARAME_RUN_TEST_PRIMARY_TOKEN;
const secondaryToken = process.env.ARAME_RUN_TEST_SECONDARY_TOKEN;
const isLocalUrl = (() => {
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(supabaseUrl).hostname);
  } catch {
    return false;
  }
})();
const configured = process.env.ARAME_RUN_TEST_MODE === "local" &&
  isLocalUrl && anonKey && editionId && primaryToken && secondaryToken;

async function rest(path, token, options = {}) {
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token ?? anonKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

test("admin permissions, report access and server pagination (local fictitious data only)", {
  skip: !configured,
}, async () => {
  const deniedPublic = await rest(
    `registrations?edition_id=eq.${editionId}&select=id`,
    null,
  );
  assert.ok([401, 403].includes(deniedPublic.status), "public client cannot read registrations");

  for (const token of [primaryToken, secondaryToken]) {
    const profileResponse = await rest(
      `admin_profiles?select=role,is_active&limit=1`,
      token,
    );
    assert.equal(profileResponse.status, 200);
    const reportResponse = await rest("rpc/admin_report", token, {
      method: "POST",
      body: JSON.stringify({ p_edition_id: editionId }),
    });
    assert.equal(reportResponse.status, 200, "both admin levels can read reports");
    const report = await reportResponse.json();
    assert.equal(typeof report.total_active, "number");
    const separateReport = await rest("rpc/admin_report", token, {
      method: "POST",
      body: JSON.stringify({ p_edition_id: separateEditionId }),
    });
    assert.equal(separateReport.status, 200);
    assert.equal((await separateReport.json()).total_active, 0,
      "report for another edition does not include registrations from the selected edition");
    const exportResponse = await rest("rpc/admin_export_page", token, {
      method: "POST",
      body: JSON.stringify({ p_edition_id: editionId, p_limit: 1, p_offset: 0 }),
    });
    assert.equal(exportResponse.status, token === primaryToken ? 200 : 403,
      "only primary admin can export report pages");

    for (const offset of [0, 1]) {
      const response = await rest(
        `registrations?edition_id=eq.${editionId}&select=id,registration_number&order=registration_number.asc&limit=1&offset=${offset}`,
        token,
      );
      assert.equal(response.status, 200);
      assert.ok((await response.json()).length <= 1, "server pagination respects limit");
    }
  }

  const candidates = await rest(
    `registrations?edition_id=eq.${editionId}&select=id&status=eq.active&limit=1`,
    secondaryToken,
  );
  assert.equal(candidates.status, 200);
  const registrations = await candidates.json();
  if (registrations.length) {
    const id = registrations[0].id;
    const paymentAttempt = await rest("rpc/confirm_registration_payment", secondaryToken, {
      method: "POST",
      body: JSON.stringify({
        p_registration_id: id,
        p_new_status: "confirmed",
        p_note: "tentativa negada de teste",
      }),
    });
    assert.ok([401, 403].includes(paymentAttempt.status),
      "secondary admin cannot confirm payment through the API");
  }

  const settingsPath = `edition_public_settings?edition_id=eq.${editionId}&select=pix_instructions`;
  const beforeResponse = await rest(settingsPath, secondaryToken);
  assert.equal(beforeResponse.status, 200);
  const before = await beforeResponse.json();
  const editAttempt = await rest(`edition_public_settings?edition_id=eq.${editionId}`, secondaryToken, {
    method: "PATCH",
    body: JSON.stringify({ pix_instructions: "alteracao de teste negada" }),
  });
  assert.ok([200, 204, 401, 403].includes(editAttempt.status));
  const after = await (await rest(settingsPath, secondaryToken)).json();
  assert.deepEqual(after, before, "secondary admin cannot change settings");
});
