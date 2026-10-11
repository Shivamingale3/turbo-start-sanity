import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const ROUTE = "/api/blog/search";
const PAGE_SIZE = 9;
const RATE_LIMIT = 30;

// Same trick as the newsletter spec: a fake x-real-ip per test gives each
// one its own rate-limit bucket. Only works against the local dev server.
function freshClient(): Record<string, string> {
  return { "x-real-ip": `e2e-${randomUUID()}` };
}

function search(params: Record<string, string>): string {
  return `${ROUTE}?${new URLSearchParams(params)}`;
}

test.describe("GET /api/blog/search", { tag: "@search" }, () => {
  test("returns one page of results in the agreed shape", async ({
    request,
  }) => {
    const response = await request.get(search({ q: "sanity" }), {
      headers: freshClient(),
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ page: 1 });
    expect(Array.isArray(body.hits)).toBe(true);
    expect(body.hits.length).toBeLessThanOrEqual(PAGE_SIZE);
    expect(typeof body.total).toBe("number");
    expect(typeof body.totalPages).toBe("number");
    expect(["algolia", "fallback"]).toContain(body.source);
  });

  test("hits are blog cards without Algolia-only fields", async ({
    request,
  }) => {
    const response = await request.get(search({ q: "sanity" }), {
      headers: freshClient(),
    });
    const { hits } = await response.json();
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit).toHaveProperty("title");
      expect(hit).toHaveProperty("slug");
      expect(hit).not.toHaveProperty("objectID");
      expect(hit).not.toHaveProperty("_highlightResult");
    }
  });

  test("a page past the end is empty, not an error", async ({ request }) => {
    const response = await request.get(search({ q: "sanity", page: "50" }), {
      headers: freshClient(),
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).hits).toEqual([]);
  });

  test("category filter only returns that category", async ({ request }) => {
    const response = await request.get(
      search({ q: "the", category: "sanity" }),
      { headers: freshClient() }
    );
    expect(response.status()).toBe(200);
    for (const hit of (await response.json()).hits) {
      expect(hit.category).toBe("sanity");
    }
  });

  for (const [name, params] of [
    ["missing query", {}],
    ["blank query", { q: "   " }],
    ["query over 100 characters", { q: "a".repeat(101) }],
    ["page 0", { q: "x", page: "0" }],
    ["page with letters", { q: "x", page: "2abc" }],
    ["page over 50", { q: "x", page: "51" }],
    ["unknown category", { q: "x", category: "cooking" }],
    ["filter injection", { q: "x", category: 'x" OR category:"y' }],
  ] as const) {
    test(`rejects ${name} with 400`, async ({ request }) => {
      const response = await request.get(search(params), {
        headers: freshClient(),
      });
      expect(response.status()).toBe(400);
      expect(await response.json()).toHaveProperty("error");
    });
  }

  test("rate limits after 30 requests a minute", async ({ request }) => {
    const headers = freshClient();
    for (let i = 0; i < RATE_LIMIT; i++) {
      const ok = await request.get(search({ q: "x" }), { headers });
      expect(ok.status()).toBe(200);
    }
    const limited = await request.get(search({ q: "x" }), { headers });
    expect(limited.status()).toBe(429);
    expect(limited.headers()["retry-after"]).toBe("60");
  });
});