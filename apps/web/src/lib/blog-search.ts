// Pure rules for GET /api/blog/search: which requests are allowed, and the
// one response shape both search paths (Algolia and the GROQ fallback) return.
import { BLOG_CATEGORIES } from "@/lib/blog-categories";
import type { Blog } from "@/types";
import { BLOG_LIST_PAGE_SIZE } from "@/utils";

// One page of results fills the same 3-column grid as the blog list.
export const SEARCH_PAGE_SIZE = BLOG_LIST_PAGE_SIZE;
// No real search needs more, and every character is sent to Algolia.
export const MAX_QUERY_LENGTH = 100;
// 50 pages of 9 is far past what anyone pages through.
export const MAX_PAGE = 50;

const ALLOWED_CATEGORIES = new Set(
  BLOG_CATEGORIES.map(({ value }) => value).filter(Boolean)
);

export type SearchRequest = {
  query: string;
  page: number;
  category: string;
};

export type SearchResponse = {
  hits: Blog[];
  page: number;
  totalPages: number;
  total: number;
  source: "algolia" | "fallback";
};

type ParseResult =
  | { ok: true; request: SearchRequest }
  | { ok: false; error: string };

export function parseSearchRequest(params: URLSearchParams): ParseResult {
  const query = (params.get("q") ?? "").trim();
  if (!query) {
    return { ok: false, error: "Query is required" };
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return {
      ok: false,
      error: `Query must be at most ${MAX_QUERY_LENGTH} characters`,
    };
  }

  const rawPage = params.get("page") ?? "1";
  const page = /^\d+$/.test(rawPage) ? Number(rawPage) : Number.NaN;
  if (!(page >= 1 && page <= MAX_PAGE)) {
    return { ok: false, error: `Page must be a whole number 1 to ${MAX_PAGE}` };
  }

  // Only known values, because the category is placed inside an Algolia
  // filter string. A free-form value could rewrite that filter.
  const category = params.get("category") ?? "";
  if (category && !ALLOWED_CATEGORIES.has(category)) {
    return { ok: false, error: "Unknown category" };
  }

  return { ok: true, request: { query, page, category } };
}

/** Slices one page out of a full result list (used by the fallback). */
export function paginate(
  items: Blog[],
  page: number
): Omit<SearchResponse, "source"> {
  const start = (page - 1) * SEARCH_PAGE_SIZE;
  return {
    hits: items.slice(start, start + SEARCH_PAGE_SIZE),
    page,
    totalPages: Math.ceil(items.length / SEARCH_PAGE_SIZE),
    total: items.length,
  };
}