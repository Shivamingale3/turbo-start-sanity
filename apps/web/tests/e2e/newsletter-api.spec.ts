import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const ROUTE = "/api/newsletter";
const JSON_ACCEPT = { accept: "application/json" };

// The limiter keys on x-real-ip. Locally nothing overwrites that header, so
// each test sends its own fake IP to get a fresh rate-limit bucket. On Vercel
// the platform sets it, so this only works against the local dev server.
function freshClient(): Record<string, string> {
  return { "x-real-ip": `e2e-${randomUUID()}` };
}

// Unique per run so repeat runs never collide with earlier documents.
function uniqueEmail(): string {
  return `e2e+${randomUUID()}@example.com`;
}

test.describe("POST /api/newsletter", { tag: "@newsletter" }, () => {
  test("accepts a native browser form post (urlencoded)", async ({
    request,
  }) => {
    const response = await request.post(ROUTE, {
      form: { email: uniqueEmail() },
      headers: { ...JSON_ACCEPT, ...freshClient() },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  test("accepts JSON", async ({ request }) => {
    const response = await request.post(ROUTE, {
      data: { email: uniqueEmail() },
      headers: { ...JSON_ACCEPT, ...freshClient() },
    });
    expect(response.status()).toBe(200);
  });

  test("answers a repeat signup exactly like a new one", async ({
    request,
  }) => {
    const email = uniqueEmail();
    const headers = { ...JSON_ACCEPT, ...freshClient() };
    const first = await request.post(ROUTE, { form: { email }, headers });
    const second = await request.post(ROUTE, { form: { email }, headers });
    expect(second.status()).toBe(first.status());
    expect(await second.json()).toEqual(await first.json());
  });

  test("rejects an invalid email with 400", async ({ request }) => {
    const response = await request.post(ROUTE, {
      form: { email: "not-an-email" },
      headers: { ...JSON_ACCEPT, ...freshClient() },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  test("fakes success when the honeypot is filled", async ({ request }) => {
    const response = await request.post(ROUTE, {
      form: { email: uniqueEmail(), website: "spam" },
      headers: { ...JSON_ACCEPT, ...freshClient() },
    });
    expect(response.status()).toBe(200);
  });

  test("rejects unsupported content types with 415", async ({ request }) => {
    const response = await request.post(ROUTE, {
      data: "hello",
      headers: {
        ...JSON_ACCEPT,
        ...freshClient(),
        "content-type": "text/plain",
      },
    });
    expect(response.status()).toBe(415);
  });

  test("rejects oversized bodies with 413", async ({ request }) => {
    const response = await request.post(ROUTE, {
      form: { email: `${"a".repeat(11 * 1024)}@example.com` },
      headers: { ...JSON_ACCEPT, ...freshClient() },
    });
    expect(response.status()).toBe(413);
  });

  test("rate limits the 6th attempt in the window", async ({ request }) => {
    const headers = { ...JSON_ACCEPT, ...freshClient() };
    // Invalid emails on purpose: they still count, and nothing gets written.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await request.post(ROUTE, {
        form: { email: "x" },
        headers,
      });
      statuses.push(response.status());
      if (i === 5) {
        expect(response.headers()["retry-after"]).toBe("600");
      }
    }
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
  });

  test("redirects a no-JS form post back to its page", async ({
    request,
    baseURL,
  }) => {
    const response = await request.post(ROUTE, {
      form: { email: uniqueEmail() },
      headers: { ...freshClient(), referer: `${baseURL}/benchmark/nesting` },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe(
      `${baseURL}/benchmark/nesting?newsletter=subscribed`
    );
  });

  test("never redirects to another site", async ({ request, baseURL }) => {
    const response = await request.post(ROUTE, {
      form: { email: "x" },
      headers: { ...freshClient(), referer: "https://evil.example/phish" },
      maxRedirects: 0,
    });
    expect(response.headers().location).toBe(`${baseURL}/?newsletter=invalid`);
  });
});