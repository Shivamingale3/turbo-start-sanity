import { Logger } from "@workspace/logger";
import { sanityFetch } from "@workspace/sanity/live";
import { queryAllBlogsForSearchIndex } from "@workspace/sanity/query";
import Fuse from "fuse.js";
import { NextResponse } from "next/server";

import { getAlgoliaSearcher } from "@/lib/algolia";
import {
  paginate,
  parseSearchRequest,
  SEARCH_PAGE_SIZE,
  type SearchRequest,
  type SearchResponse,
} from "@/lib/blog-search";
import { isIndexable, toSearchRecord } from "@/lib/blog-search-record";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import type { Blog } from "@/types";

const logger = new Logger("BlogSearch");

// Search runs as the user types (debounced), so one search is a few
// requests. 30 a minute per IP is plenty for a person and stops a script
// running up Algolia's per-search bill.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;

// Hard cap on waiting for Algolia before falling back. The SDK's own
// timeouts apply per host and it retries other hosts, so it could take
// longer on its own.
const ALGOLIA_DEADLINE_MS = 2500;

// Exactly the fields a blog card renders, so hits match the Blog type and
// skip objectID, timestamps and highlight data the page never uses.
const CARD_ATTRIBUTES = [
  "_type",
  "_id",
  "title",
  "description",
  "slug",
  "orderRank",
  "category",
  "image",
  "publishedAt",
  "authors",
];

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Algolia deadline")), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Null when Algolia is not configured, so the caller falls back. */
async function searchAlgolia(
  request: SearchRequest
): Promise<SearchResponse | null> {
  const searcher = getAlgoliaSearcher();
  if (!searcher) {
    return null;
  }
  const result = await withDeadline(
    searcher.client.searchSingleIndex<Blog>({
      indexName: searcher.indexName,
      searchParams: {
        query: request.query,
        page: request.page - 1, // Algolia pages start at 0
        hitsPerPage: SEARCH_PAGE_SIZE,
        filters: request.category ? `category:"${request.category}"` : "",
        attributesToRetrieve: CARD_ATTRIBUTES,
        attributesToHighlight: [],
      },
    }),
    ALGOLIA_DEADLINE_MS
  );
  return {
    hits: result.hits.map(({ objectID: _objectID, ...blog }) => blog as Blog),
    page: request.page,
    totalPages: result.nbPages ?? 0,
    total: result.nbHits ?? 0,
    source: "algolia",
  };
}

// Published only, whatever the draft-mode cookie says: Algolia never holds
// drafts, so the fallback must not show them either.
async function getPublishedSearchablePosts(): Promise<Blog[]> {
  "use cache";
  const { data } = await sanityFetch({
    query: queryAllBlogsForSearchIndex,
    perspective: "published",
    stega: false,
  });
  // Same rule and record shape as the index, then back to the card fields.
  return data
    .filter(isIndexable)
    .map(toSearchRecord)
    .map(
      ({
        objectID: _objectID,
        publishedAtTimestamp: _timestamp,
        _updatedAt: _updated,
        ...blog
      }) => blog
    );
}

async function searchFallback(request: SearchRequest): Promise<SearchResponse> {
  const posts = await getPublishedSearchablePosts();
  const inCategory = request.category
    ? posts.filter((post) => post.category === request.category)
    : posts;
  const fuse = new Fuse(inCategory, {
    keys: ["title", "description", "authors.name"],
    threshold: 0.3,
  });
  const matches = fuse.search(request.query).map((match) => match.item);
  return { ...paginate(matches, request.page), source: "fallback" };
}

export async function GET(request: Request) {
  // Rate limit first: the cheapest check protects everything after it.
  const limit = await rateLimit({
    key: clientKey(request, "blog-search"),
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many searches, try again shortly" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      }
    );
  }

  const parsed = parseSearchRequest(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await searchAlgolia(parsed.request);
    if (result) {
      return NextResponse.json(result);
    }
  } catch (error) {
    logger.warn(
      "Algolia search failed, using GROQ fallback",
      error instanceof Error ? error.message : "unknown"
    );
  }

  try {
    return NextResponse.json(await searchFallback(parsed.request));
  } catch (error) {
    logger.error(
      "Fallback search failed",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: "Search is unavailable, try again shortly" },
      { status: 503 }
    );
  }
}