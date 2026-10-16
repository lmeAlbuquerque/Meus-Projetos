import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const editionId = process.env.ARAME_RUN_TEST_EDITION_ID;
const origin = process.env.ARAME_RUN_ORIGIN ?? "http://localhost:4173";
const isLocalUrl = (() => {
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
})();

test("allocates unique numbers for concurrent fictitious signups", {
  skip: process.env.ARAME_RUN_TEST_MODE !== "local" ||
    !isLocalUrl || !anonKey || !editionId,
}, async () => {
  const headers = { apikey: anonKey, "Content-Type": "application/json", Origin: origin };
  const editions = await fetch(`${baseUrl}/rest/v1/editions?id=eq.${editionId}&select=id`, { headers });
  assert.equal(editions.status, 200);
  const categoriesResponse = await fetch(
    `${baseUrl}/rest/v1/categories?edition_id=eq.${editionId}&is_active=eq.true&select=id`,
    { headers },
  );
  assert.equal(categoriesResponse.status, 200);
  const categories = await categoriesResponse.json();
  assert.ok(categories.length, "test edition must have an active category");
  const categoryId = categories[0].id;
  const requests = Array.from({ length: 12 }, (_, index) => fetch(`${baseUrl}/functions/v1/public-registration`, {
    method: "POST",
    headers: { ...headers, "cf-connecting-ip": `192.0.2.${index + 1}` },
    body: JSON.stringify({
      editionId,
      categoryId,
      fullName: `Participante Ficticio ${randomUUID()}`,
      phone: `+1555${String(Date.now()).slice(-7)}${String(index).padStart(2, "0")}`,
      birthDate: "1990-01-01",
      gender: "female",
      shirtSize: "M",
    }),
  }));
  const responses = await Promise.all(requests);
  const result = await Promise.all(responses.map(async (response) => ({
    status: response.status,
    body: await response.json(),
  })));
  assert.ok(result.every((item) => item.status === 201),
    JSON.stringify(result.filter((item) => item.status !== 201)));
  const numbers = result.map((item) => item.body.registrationNumber);
  assert.equal(new Set(numbers).size, numbers.length);
  assert.ok(result.every((item) => typeof item.body.statusUrl === "string" &&
    item.body.statusUrl.includes("#") && !item.body.statusUrl.includes("?")));

  const lookup = await fetch(`${baseUrl}/functions/v1/registration-lookup`, {
    method: "POST",
    headers: { ...headers, "cf-connecting-ip": "192.0.2.100" },
    body: JSON.stringify({ token: new URL(result[0].body.statusUrl).hash.slice(1) }),
  });
  assert.equal(lookup.status, 200);
  const ownRegistration = await lookup.json();
  assert.equal(ownRegistration.registration_number, numbers[0]);
  assert.equal(Object.hasOwn(ownRegistration, "phone_e164"), false);
  assert.equal(Object.hasOwn(ownRegistration, "full_name"), false);
  const unrelatedLookup = await fetch(`${baseUrl}/functions/v1/registration-lookup`, {
    method: "POST",
    headers: { ...headers, "cf-connecting-ip": "192.0.2.101" },
    body: JSON.stringify({ token: "0".repeat(64) }),
  });
  assert.equal(unrelatedLookup.status, 404);

  const duplicatePayload = {
    editionId,
    categoryId,
    fullName: "Pessoa Ficticia Duplicada",
    phone: "+1555123456701",
    birthDate: "1990-01-01",
    gender: "male",
    shirtSize: "M",
  };
  const duplicateRequests = await Promise.all([1, 2].map(() =>
    fetch(`${baseUrl}/functions/v1/public-registration`, {
      method: "POST",
      headers: { ...headers, "cf-connecting-ip": "192.0.2.220" },
      body: JSON.stringify(duplicatePayload),
    })));
  assert.deepEqual(duplicateRequests.map((response) => response.status).sort(), [201, 409],
    "concurrent duplicate submissions produce a single active registration");

  const spamResponses = [];
  for (let index = 0; index < 6; index += 1) {
    spamResponses.push(await fetch(`${baseUrl}/functions/v1/public-registration`, {
      method: "POST",
      headers: { ...headers, "cf-connecting-ip": "192.0.2.221" },
      body: JSON.stringify({
        ...duplicatePayload,
        fullName: `Participante Rate Limit ${index}`,
        phone: `+1555987654${String(index).padStart(3, "0")}`,
      }),
    }));
  }
  assert.deepEqual(spamResponses.map((response) => response.status), [201, 201, 201, 201, 201, 429],
    "signup rate limit blocks the sixth request from one network in an hour");

  const rotated = await fetch(`${baseUrl}/functions/v1/rotate-registration-link`, {
    method: "POST",
    headers: {
      ...headers,
      Authorization: `Bearer ${process.env.ARAME_RUN_TEST_PRIMARY_TOKEN ?? ""}`,
    },
    body: JSON.stringify({ registrationId: result[0].body.registrationId }),
  });
  if (process.env.ARAME_RUN_TEST_PRIMARY_TOKEN) {
    assert.equal(rotated.status, 200);
    const newLink = await rotated.json();
    const oldLinkCheck = await fetch(`${baseUrl}/functions/v1/registration-lookup`, {
      method: "POST",
      headers: { ...headers, "cf-connecting-ip": "192.0.2.102" },
      body: JSON.stringify({ token: new URL(result[0].body.statusUrl).hash.slice(1) }),
    });
    assert.equal(oldLinkCheck.status, 404, "rotating the link invalidates the previous token");
    const newLinkCheck = await fetch(`${baseUrl}/functions/v1/registration-lookup`, {
      method: "POST",
      headers: { ...headers, "cf-connecting-ip": "192.0.2.103" },
      body: JSON.stringify({ token: new URL(newLink.statusUrl).hash.slice(1) }),
    });
    assert.equal(newLinkCheck.status, 200, "the replacement link resolves the same registration");
  } else {
    assert.ok([401, 403].includes(rotated.status),
      "secondary/public session cannot rotate private links");
  }
});
