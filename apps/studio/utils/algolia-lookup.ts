// Looks up one blog record in Algolia from the browser. Uses the search-only
// key, which can read records but never write or change settings, so it is
// safe to ship in the Studio bundle. A plain fetch keeps the Studio free of
// the Algolia SDK for a single GET request.

const appId = process.env.SANITY_STUDIO_ALGOLIA_APP_ID ?? "";
const searchKey = process.env.SANITY_STUDIO_ALGOLIA_SEARCH_API_KEY ?? "";
const indexName = process.env.SANITY_STUDIO_ALGOLIA_INDEX_NAME ?? "";

export const isAlgoliaConfigured = Boolean(appId && searchKey && indexName);

export type IndexLookup = "found" | "missing";

/**
 * "found" or "missing" (Algolia answers 404 for an unknown objectID).
 * Throws on anything else, such as a network failure or a bad key, so the
 * tab can tell "not in the index" apart from "could not ask".
 */
export async function lookupIndexRecord(
  objectID: string,
  signal: AbortSignal
): Promise<IndexLookup> {
  const url = `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(indexName)}/${encodeURIComponent(objectID)}?attributesToRetrieve=objectID`;
  const response = await fetch(url, {
    headers: {
      "X-Algolia-Application-Id": appId,
      "X-Algolia-API-Key": searchKey,
    },
    signal,
  });
  if (response.status === 404) {
    return "missing";
  }
  if (!response.ok) {
    throw new Error(`Algolia responded with ${response.status}`);
  }
  return "found";
}