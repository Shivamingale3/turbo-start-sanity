import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useDebounce } from "@/hooks/use-debounce";
import type { SearchResponse } from "@/lib/blog-search";

const SEARCH_DEBOUNCE_MS = 400;
const CACHE_STALE_TIME_MS = 30_000;

type SearchInput = { query: string; category: string; page: number };

async function searchBlog(
  { query, category, page }: SearchInput,
  signal: AbortSignal
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, page: String(page) });
  if (category) {
    params.set("category", category);
  }

  const response = await fetch(`/api/blog/search?${params}`, { signal });

  if (!response.ok) {
    throw new Error("Failed to search");
  }

  return response.json() as Promise<SearchResponse>;
}

/**
 * Search state for the blog sidebar. `category` comes from the page URL, so
 * the sidebar filter narrows search results too.
 */
export function useBlogSearch(category: string) {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, SEARCH_DEBOUNCE_MS);
  const hasQuery = debouncedQuery.trim().length > 0;

  // The page belongs to one query and category. Change either and the key
  // no longer matches, so the page falls back to 1 without an effect.
  const searchKey = `${debouncedQuery}|${category}`;
  const [pageState, setPageState] = useState({ key: searchKey, page: 1 });
  const page = pageState.key === searchKey ? pageState.page : 1;
  const goToPage = (next: number) =>
    setPageState({ key: searchKey, page: next });

  const { data, isLoading, error } = useQuery({
    queryKey: ["blog-search", debouncedQuery, category, page],
    queryFn: ({ signal }) =>
      searchBlog({ query: debouncedQuery, category, page }, signal),
    enabled: hasQuery,
    staleTime: CACHE_STALE_TIME_MS,
    // Keep the current page on screen while the next one loads.
    placeholderData: keepPreviousData,
  });

  return {
    searchQuery,
    setSearchQuery,
    results: data?.hits ?? [],
    total: data?.total ?? 0,
    page,
    totalPages: data?.totalPages ?? 0,
    goToPage,
    isSearching: isLoading,
    error,
    hasQuery,
  };
}