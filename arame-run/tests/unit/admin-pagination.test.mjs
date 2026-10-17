import test from "node:test";
import assert from "node:assert/strict";
import { adminSelectPage } from "../../public/js/supabase-rest.js";

test("adminSelectPage returns one page and the exact total count", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = {
    ARAME_RUN_CONFIG: {
      supabaseUrl: "https://arame-test.supabase.co",
      supabaseAnonKey: "test-anon-key",
    },
  };
  globalThis.fetch = async (url, options) => {
    const query = new URL(url).searchParams;
    assert.equal(query.get("limit"), "20");
    assert.equal(query.get("offset"), "20");
    assert.equal(options.headers.Prefer, "count=exact");
    return new Response(JSON.stringify([{ id: "edition-21" }]), {
      status: 200,
      headers: {
        "content-range": "20-20/21",
        "content-type": "application/json",
      },
    });
  };

  try {
    const result = await adminSelectPage("editions", {
      select: "id",
      limit: "20",
      offset: "20",
    }, "test-token");
    assert.deepEqual(result, {
      rows: [{ id: "edition-21" }],
      total: 21,
    });
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
