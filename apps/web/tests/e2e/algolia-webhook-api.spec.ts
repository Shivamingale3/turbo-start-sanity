import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import dotenv from "dotenv";

// The secret and Algolia keys live in apps/web/.env (the Playwright config
// only loads .env.local).
dotenv.config({
  path: path.resolve(import.meta.dirname, "../../.env"),
  quiet: true,
});

const ROUTE = "/api/webhooks/algolia";
const SECRET = process.env.SANITY_ALGOLIA_WEBHOOK_SECRET ?? "";
const APP_ID = process.env.ALGOLIA_APP_ID ?? "";
const SEARCH_KEY = process.env.ALGOLIA_SEARCH_API_KEY ?? "";
const INDEX = process.env.ALGOLIA_INDEX_NAME ?? "";

// Real documents from the dataset (Phase 0): post A is published and
// indexable, post C only exists as a draft.
const PUBLISHED_POST_ID = "a4214d5f-6223-4547-b65a-f36eb7cd4f1d";
const DRAFT_POST_ID = "drafts.950b9401-907b-488f-8ca3-835d6ba6f1ab";

/** Signs like Sanity: HMAC-SHA256 over "<timestamp>.<body>", base64url. */
function sign(body: string, secret = SECRET): string {
  const timestamp = Date.now();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("base64url");
  return `t=${timestamp},v1=${signature}`;
}

function event(
  _id: string,
  operation: "create" | "update" | "delete",
  _type = "blog"
): string {
  return JSON.stringify({
    _id,
    _type,
    _updatedAt: new Date(0).toISOString(),
    operation,
  });
}

/** Reads one record straight from Algolia with the search-only key. */
async function algoliaRecord(objectID: string): Promise<number> {
  const response = await fetch(
    `https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/${objectID}`,
    {
      headers: {
        "x-algolia-application-id": APP_ID,
        "x-algolia-api-key": SEARCH_KEY,
      },
    }
  );
  return response.status;
}

// One shared index and shared documents: run in order, not in parallel.
test.describe.configure({ mode: "serial" });

test.describe("POST /api/webhooks/algolia", { tag: "@algolia" }, () => {
  test("rejects a request without a signature (401)", async ({ request }) => {
    const response = await request.post(ROUTE, {
      data: event(PUBLISHED_POST_ID, "update"),
      headers: { "content-type": "application/json" },
    });
    expect(response.status()).toBe(401);
  });

  test("rejects a forged signature (401)", async ({ request }) => {
    const body = event(PUBLISHED_POST_ID, "update");
    const response = await request.post(ROUTE, {
      data: body,
      headers: {
        "content-type": "application/json",
        "sanity-webhook-signature": sign(body, "not-the-real-secret"),
      },
    });
    expect(response.status()).toBe(401);
  });

  test("rejects a body that was changed after signing (401)", async ({
    request,
  }) => {
    const signedFor = event(PUBLISHED_POST_ID, "update");
    const response = await request.post(ROUTE, {
      data: event(randomUUID(), "delete"),
      headers: {
        "content-type": "application/json",
        "sanity-webhook-signature": sign(signedFor),
      },
    });
    expect(response.status()).toBe(401);
  });

  test("rejects a signed but malformed payload (400)", async ({ request }) => {
    const body = JSON.stringify({ hello: "world" });
    const response = await request.post(ROUTE, {
      data: body,
      headers: {
        "content-type": "application/json",
        "sanity-webhook-signature": sign(body),
      },
    });
    expect(response.status()).toBe(400);
  });

  test("ignores other document types (200, skipped)", async ({ request }) => {
    const body = event("homePage", "update", "homePage");
    const response = await request.post(ROUTE, {
      data: body,
      headers: {
        "content-type": "application/json",
        "sanity-webhook-signature": sign(body),
      },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty("skipped");
  });

  test("never indexes a draft (200, skipped)", async ({ request }) => {
    const body = event(DRAFT_POST_ID, "update");
    const response = await request.post(ROUTE, {
      data: body,
      headers: {
        "content-type": "application/json",
        "sanity-webhook-signature": sign(body),
      },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty("skipped");
    expect(await algoliaRecord(DRAFT_POST_ID)).toBe(404);
  });

  test("indexes a published post, and a repeat delivery keeps one record", async ({
    request,
  }) => {
    const body = event(PUBLISHED_POST_ID, "update");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request.post(ROUTE, {
        data: body,
        headers: {
          "content-type": "application/json",
          "sanity-webhook-signature": sign(body),
        },
      });
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ action: "indexed" });
    }
    // objectID = _id, so there is exactly one record to find.
    await expect.poll(() => algoliaRecord(PUBLISHED_POST_ID)).toBe(200);
  });

  test("removes a deleted post (200, removed)", async ({ request }) => {
    const body = event(randomUUID(), "delete");
    const response = await request.post(ROUTE, {
      data: body,
      headers: {
        "content-type": "application/json",
        "sanity-webhook-signature": sign(body),
      },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ action: "removed" });
  });

  test("asks Sanity to retry when the read is behind the event (503)", async ({
    request,
  }) => {
    // An update for a post that doesn't exist (yet): the route waits once,
    // still can't see it, and returns 503 so Sanity redelivers later.
    const body = event(randomUUID(), "update");
    const response = await request.post(ROUTE, {
      data: body,
      headers: {
        "content-type": "application/json",
        "sanity-webhook-signature": sign(body),
      },
    });
    expect(response.status()).toBe(503);
  });
});