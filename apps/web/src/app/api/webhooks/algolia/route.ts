import { env } from "@workspace/env/server";
import { Logger } from "@workspace/logger";
import { client } from "@workspace/sanity/client";
import { queryBlogForSearchIndex } from "@workspace/sanity/query";
import { NextResponse } from "next/server";

import { getAlgoliaWriter } from "@/lib/algolia";
import { isIndexable, toSearchRecord } from "@/lib/blog-search-record";
import {
  isValidSanitySignature,
  SANITY_SIGNATURE_HEADER,
} from "@/lib/sanity-webhook";

const logger = new Logger("AlgoliaSync");

// The projection is {_id, _type, _updatedAt, operation}: about 150 bytes.
// Anything near this size is not a real delivery.
const MAX_BODY_BYTES = 16 * 1024;

// One retry for Content Lake's eventual consistency (see isStale).
const CONSISTENCY_RETRY_MS = 1000;

// Published perspective: drafts can never be read, so never indexed.
// No CDN: it can serve the version from before the publish that fired this.
// No stega: dev mode would otherwise hide markers inside the strings.
const readClient = client.withConfig({
  useCdn: false,
  perspective: "published",
  stega: false,
});

type SyncEvent = {
  _id: string;
  _type: string;
  _updatedAt?: string;
  operation: "create" | "update" | "delete";
};

/** Body → event, or null if it isn't the shape our projection sends. */
function parseEvent(rawBody: string): SyncEvent | null {
  try {
    const body: unknown = JSON.parse(rawBody);
    if (!body || typeof body !== "object") {
      return null;
    }
    const { _id, _type, _updatedAt, operation } = body as Record<
      string,
      unknown
    >;
    if (typeof _id !== "string" || typeof _type !== "string") {
      return null;
    }
    if (
      operation !== "create" &&
      operation !== "update" &&
      operation !== "delete"
    ) {
      return null;
    }
    return {
      _id,
      _type,
      _updatedAt: typeof _updatedAt === "string" ? _updatedAt : undefined,
      operation,
    };
  } catch {
    return null;
  }
}

async function fetchCurrent(id: string) {
  return readClient.fetch(queryBlogForSearchIndex, { id });
}

/**
 * True when the read is behind the write that triggered this webhook: the
 * post is missing after a create/update, or older than the event.
 */
function isStale(
  event: SyncEvent,
  doc: Awaited<ReturnType<typeof fetchCurrent>>
): boolean {
  if (event.operation === "delete") {
    return false;
  }
  if (!doc) {
    return true;
  }
  return Boolean(event._updatedAt && doc._updatedAt < event._updatedAt);
}

export async function POST(request: Request) {
  const contentLength = Number.parseInt(
    request.headers.get("content-length") ?? "0",
    10
  );
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  // Raw text, not .json(): the signature covers these exact bytes.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get(SANITY_SIGNATURE_HEADER);
  const secret = env.SANITY_ALGOLIA_WEBHOOK_SECRET;

  // Fail closed: no secret, no header or a wrong signature are all 401.
  if (!isValidSanitySignature({ rawBody, signatureHeader, secret })) {
    logger.warn("Rejected webhook with invalid signature", {
      hasSignature: Boolean(signatureHeader),
      secretConfigured: Boolean(secret),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const event = parseEvent(rawBody);
  if (!event) {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  // Not ours to sync. 200 so Sanity doesn't retry something we'll never do.
  if (event._type !== "blog") {
    return NextResponse.json({ skipped: "not a blog post" });
  }

  // Any dotted _id is a draft (drafts.) or release version (versions.),
  // never the published document. The webhook filter should already stop
  // these; this is the second layer.
  if (event._id.includes(".")) {
    return NextResponse.json({ skipped: "not a published document" });
  }

  const algolia = getAlgoliaWriter();
  if (!algolia) {
    logger.error("Algolia is not configured");
    return NextResponse.json(
      { error: "Search not configured" },
      { status: 503 }
    );
  }

  try {
    let doc = await fetchCurrent(event._id);
    if (isStale(event, doc)) {
      await new Promise((resolve) => setTimeout(resolve, CONSISTENCY_RETRY_MS));
      doc = await fetchCurrent(event._id);
      if (isStale(event, doc)) {
        // Sanity retries non-2xx deliveries, so the next attempt catches up.
        logger.warn("Read still behind the webhook event, asking for retry", {
          id: event._id,
        });
        return NextResponse.json(
          { error: "Not yet consistent" },
          { status: 503 }
        );
      }
    }

    // Decide from the current state, not from the event. Deliveries can
    // repeat or arrive out of order; the current state is always right.
    if (isIndexable(doc)) {
      await algolia.client.saveObject({
        indexName: algolia.indexName,
        body: toSearchRecord(doc),
      });
      logger.info("Indexed", { id: event._id, operation: event.operation });
      return NextResponse.json({ action: "indexed", id: event._id });
    }

    await algolia.client.deleteObject({
      indexName: algolia.indexName,
      objectID: event._id,
    });
    logger.info("Removed from index", {
      id: event._id,
      operation: event.operation,
    });
    return NextResponse.json({ action: "removed", id: event._id });
  } catch (error) {
    // Sanity or Algolia failed. 503 so Sanity retries the delivery.
    logger.error("Sync failed", {
      id: event._id,
      reason: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Sync failed" }, { status: 503 });
  }
}
