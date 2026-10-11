// One-time (and safe to re-run) sync of every published blog post into
// Algolia. The webhook keeps the index fresh from then on.
//
// Run from apps/studio:
//   pnpm backfill:algolia -- --dry-run   report only
//   pnpm backfill:algolia                apply settings, save, delete
import "./load-env";

import { Logger } from "@workspace/logger";
import { client } from "@workspace/sanity/client";
import { queryAllBlogsForSearchIndex } from "@workspace/sanity/query";
import type { IndexSettings } from "algoliasearch";

import { getAlgoliaWriter } from "../src/lib/algolia";
import { isIndexable, toSearchRecord } from "../src/lib/blog-search-record";

const logger = new Logger("backfill-algolia");

// Same read settings as the webhook: published only, fresh from the API.
const readClient = client.withConfig({
  useCdn: false,
  perspective: "published",
  stega: false,
});

// Kept in code so a new index is set up by running this script, not by
// clicking through the dashboard. Order in searchableAttributes is priority.
const INDEX_SETTINGS: IndexSettings = {
  searchableAttributes: ["title", "description", "authors.name"],
  // The blog sidebar only filters by category and shows no counts, so
  // filterOnly is enough and cheaper than a full facet.
  attributesForFaceting: ["filterOnly(category)"],
  customRanking: ["desc(publishedAtTimestamp)"],
};

async function listIndexedIds(
  writer: NonNullable<ReturnType<typeof getAlgoliaWriter>>
): Promise<Set<string>> {
  const ids = new Set<string>();
  await writer.client.browseObjects<{ objectID: string }>({
    indexName: writer.indexName,
    browseParams: { attributesToRetrieve: ["objectID"], hitsPerPage: 1000 },
    aggregator: (page) => {
      for (const hit of page.hits) {
        ids.add(hit.objectID);
      }
    },
  });
  return ids;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const writer = getAlgoliaWriter();
  if (!writer) {
    throw new Error(
      "Set ALGOLIA_APP_ID, ALGOLIA_WRITE_API_KEY and ALGOLIA_INDEX_NAME in apps/web/.env"
    );
  }

  const posts = await readClient.fetch(queryAllBlogsForSearchIndex);
  const records = posts.filter(isIndexable).map(toSearchRecord);
  const wanted = new Set(records.map((record) => record.objectID));

  const indexed = await listIndexedIds(writer);
  const stale = [...indexed].filter((id) => !wanted.has(id));

  logger.info(
    `${posts.length} posts in Sanity, ${records.length} to save, ${stale.length} to delete from "${writer.indexName}"`
  );

  if (dryRun) {
    logger.info("Dry run, nothing written.");
    return;
  }

  const { indexName } = writer;
  const settings = await writer.client.setSettings({
    indexName,
    indexSettings: INDEX_SETTINGS,
  });
  await writer.client.waitForTask({ indexName, taskID: settings.taskID });

  // waitForTasks so the counts below are true when the script exits.
  await writer.client.saveObjects({
    indexName,
    objects: records,
    waitForTasks: true,
  });
  if (stale.length > 0) {
    await writer.client.deleteObjects({
      indexName,
      objectIDs: stale,
      waitForTasks: true,
    });
  }

  logger.info(`Done. Saved ${records.length}, deleted ${stale.length}.`);
}

main().catch((error: unknown) => {
  logger.error(
    "Backfill failed:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
