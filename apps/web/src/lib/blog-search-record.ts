// Pure mapping from a Sanity blog post to its Algolia record. Shared by the
// sync webhook and the backfill so both always write the same shape.
import type { QueryBlogForSearchIndexResult } from "@workspace/sanity/types";

type BlogForIndex = NonNullable<QueryBlogForSearchIndexResult>;

/**
 * The record is the blog card shape the site already renders, plus what
 * Algolia needs: objectID (= Sanity _id, so writes are idempotent) and a
 * numeric date, because Algolia sorts and filters on numbers, not strings.
 */
export type BlogSearchRecord = Omit<
  BlogForIndex,
  "seoNoIndex" | "seoHideFromLists"
> & {
  objectID: string;
  publishedAtTimestamp: number | null;
};

/**
 * Whether a post belongs in search: it exists (published perspective), has
 * a title and slug, and is neither noindex nor hidden from lists. Matches
 * the filter in queryAllBlogsForSearchIndex and the existing site search.
 */
export function isIndexable(
  doc: QueryBlogForSearchIndexResult
): doc is BlogForIndex {
  return Boolean(
    doc?.title &&
      doc.slug &&
      doc.seoNoIndex !== true &&
      doc.seoHideFromLists !== true
  );
}

/** publishedAt is a date string ("2026-10-07"); unix seconds or null. */
function toTimestamp(date: string | null): number | null {
  if (!date) {
    return null;
  }
  const ms = Date.parse(date);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export function toSearchRecord(doc: BlogForIndex): BlogSearchRecord {
  const { seoNoIndex: _noIndex, seoHideFromLists: _hidden, ...card } = doc;
  return {
    ...card,
    objectID: doc._id,
    publishedAtTimestamp: toTimestamp(doc.publishedAt),
  };
}
