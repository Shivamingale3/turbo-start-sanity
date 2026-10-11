import { env } from "@workspace/env/server";
import { algoliasearch } from "algoliasearch";

// Server only: uses the write key, which must never reach the browser.
// Short timeouts so a slow Algolia fails fast and Sanity retries the
// delivery, instead of holding our function open.
export function getAlgoliaWriter() {
  const { ALGOLIA_APP_ID, ALGOLIA_WRITE_API_KEY, ALGOLIA_INDEX_NAME } = env;
  if (!(ALGOLIA_APP_ID && ALGOLIA_WRITE_API_KEY && ALGOLIA_INDEX_NAME)) {
    return null;
  }
  return {
    client: algoliasearch(ALGOLIA_APP_ID, ALGOLIA_WRITE_API_KEY, {
      timeouts: { connect: 2000, read: 5000, write: 5000 },
    }),
    indexName: ALGOLIA_INDEX_NAME,
  };
}

// Server only, for the search route. Uses the search-only key: the route
// reads the index and nothing more, so it never holds a key that can write.
// The search route also caps the total wait itself (the SDK retries other
// hosts after a timeout), then falls back to GROQ.
export function getAlgoliaSearcher() {
  const { ALGOLIA_APP_ID, ALGOLIA_SEARCH_API_KEY, ALGOLIA_INDEX_NAME } = env;
  if (!(ALGOLIA_APP_ID && ALGOLIA_SEARCH_API_KEY && ALGOLIA_INDEX_NAME)) {
    return null;
  }
  return {
    client: algoliasearch(ALGOLIA_APP_ID, ALGOLIA_SEARCH_API_KEY, {
      timeouts: { connect: 1000, read: 2000, write: 2000 },
    }),
    indexName: ALGOLIA_INDEX_NAME,
  };
}
