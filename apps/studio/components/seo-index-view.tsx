import { Button, Card, Flex, Stack, Text } from "@sanity/ui";
import { useEffect, useState } from "react";
import type { UserViewComponent } from "sanity/structure";

import {
  type IndexLookup,
  isAlgoliaConfigured,
  lookupIndexRecord,
} from "@/utils/algolia-lookup";
import {
  type CheckTone,
  DESCRIPTION_MAX,
  getEffectiveSeo,
  getIndexBlocker,
  getSeoChecks,
  type SeoCheck,
  type SeoDocument,
  TITLE_MAX,
  toBreadcrumb,
  truncate,
} from "@/utils/seo-checks";

// Algolia applies a write a few seconds after the webhook sends it. A post
// published within this window gets one automatic recheck instead of a red
// mismatch that would fix itself.
const RECENT_PUBLISH_MS = 30_000;
const RECHECK_DELAY_MS = 5000;

// Production site URL, so the preview shows the real domain.
const siteUrl = process.env.SANITY_STUDIO_PRESENTATION_URL;

const titleStyle = { color: "var(--card-link-color)" } as const;

// Same text colours as components/url-slug/validation-messages.tsx, so the
// tab matches the warnings editors already see on the slug field.
const toneTextStyle: Partial<Record<CheckTone, { color: string }>> = {
  critical: { color: "var(--card-badge-critical-fg-color)" },
  caution: { color: "var(--card-badge-caution-fg-color)" },
  positive: { color: "var(--card-badge-positive-fg-color)" },
};

type Lookup =
  | { state: "loading" }
  | { state: "error" }
  | { state: "done"; result: IndexLookup };

function StatusCard({ tone, message }: { tone: CheckTone; message: string }) {
  return (
    <Card padding={3} radius={2} tone={tone}>
      <Text size={1} style={toneTextStyle[tone]}>
        {message}
      </Text>
    </Card>
  );
}

function CheckRow({ check }: { check: SeoCheck }) {
  return (
    <Card padding={3} radius={2} tone={check.tone}>
      <Text size={1} style={toneTextStyle[check.tone]}>
        {check.pass ? "✓" : "✗"} {check.message}
      </Text>
    </Card>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <Flex align="center" gap={2}>
      <Text size={1} weight="semibold">
        {title}
      </Text>
      <Text muted size={1}>
        {hint}
      </Text>
    </Flex>
  );
}

/** Turns "should it be indexed" plus "is it indexed" into one card. */
function describeIndexStatus(
  lookup: Lookup,
  blocker: string | null,
  settling: boolean
): { tone: CheckTone; message: string } {
  if (lookup.state === "loading") {
    return { tone: "default", message: "Checking the search index…" };
  }
  if (lookup.state === "error") {
    return {
      tone: "caution",
      message:
        "Couldn't reach Algolia. Check your connection and press Recheck.",
    };
  }
  const found = lookup.result === "found";
  const shouldBeIndexed = blocker === null;
  if (found !== shouldBeIndexed && settling) {
    return {
      tone: "default",
      message: "Search index is updating. Checking again in a few seconds.",
    };
  }
  if (shouldBeIndexed && found) {
    return { tone: "positive", message: "In the search index." };
  }
  if (shouldBeIndexed) {
    return {
      tone: "critical",
      message: "Published but missing from the search index.",
    };
  }
  if (found) {
    return {
      tone: "critical",
      message: `Should not be in search because ${blocker}, but it is.`,
    };
  }
  return { tone: "default", message: `Not in search because ${blocker}.` };
}

/**
 * Read-only "SEO & Index" tab for blog posts. The preview and SEO checks read
 * `displayed` (the live draft), so they update as the editor types. The index
 * status reads `published`, because only published posts reach Algolia.
 */
export const SeoIndexView: UserViewComponent = ({ document, documentId }) => {
  const draft = document.displayed as SeoDocument;
  const published = document.published as SeoDocument | null;
  const seo = getEffectiveSeo(draft);
  const checks = getSeoChecks(draft);

  const objectID = documentId.replace(/^drafts\./, "");
  const publishedAt = document.published?._updatedAt;
  const [lookup, setLookup] = useState<Lookup>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [settling, setSettling] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: publishedAt and attempt are triggers, not inputs. A new published version or a Recheck click runs the lookup again.
  useEffect(() => {
    if (!isAlgoliaConfigured) {
      return;
    }
    const controller = new AbortController();
    setLookup({ state: "loading" });
    lookupIndexRecord(objectID, controller.signal)
      .then((result) => setLookup({ state: "done", result }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setLookup({ state: "error" });
        }
      });
    return () => controller.abort();
  }, [objectID, publishedAt, attempt]);

  // Just published: hold off on a red mismatch and recheck once.
  useEffect(() => {
    if (!publishedAt) {
      return;
    }
    if (Date.now() - Date.parse(publishedAt) > RECENT_PUBLISH_MS) {
      return;
    }
    setSettling(true);
    const timer = setTimeout(() => {
      setSettling(false);
      setAttempt((count) => count + 1);
    }, RECHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [publishedAt]);

  const blocker = published
    ? getIndexBlocker(published)
    : "it is not published";
  const status = describeIndexStatus(lookup, blocker, settling);
  const draftChangesSearch =
    published !== null &&
    document.draft !== null &&
    (getIndexBlocker(draft) === null) !== (blocker === null);

  return (
    <Stack gap={5} padding={4}>
      <Stack gap={3}>
        <Text size={1} weight="semibold">
          SEARCH PREVIEW
        </Text>
        <Card border padding={4} radius={2}>
          <Stack gap={3}>
            <Text muted size={1}>
              {toBreadcrumb(siteUrl, seo.path || "/blog")}
            </Text>
            <Text size={3} style={titleStyle}>
              {truncate(seo.title || "Untitled", TITLE_MAX)}
            </Text>
            <Text size={1}>
              {seo.description
                ? truncate(seo.description, DESCRIPTION_MAX)
                : "No description yet."}
            </Text>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={3}>
        <SectionTitle hint="from your draft" title="SEO CHECKS" />
        <Stack gap={2}>
          {checks.map((check) => (
            <CheckRow check={check} key={check.id} />
          ))}
        </Stack>
      </Stack>

      <Stack gap={3}>
        <SectionTitle hint="published version" title="SEARCH INDEX" />
        {isAlgoliaConfigured ? (
          <Stack gap={2}>
            <StatusCard message={status.message} tone={status.tone} />
            {draftChangesSearch ? (
              <StatusCard
                message="Unpublished changes will change the search status after you publish."
                tone="default"
              />
            ) : null}
            <Flex>
              <Button
                disabled={lookup.state === "loading"}
                mode="ghost"
                onClick={() => setAttempt((count) => count + 1)}
                text="Recheck"
              />
            </Flex>
          </Stack>
        ) : (
          <StatusCard
            message="Index status unavailable. Algolia is not configured for the Studio."
            tone="default"
          />
        )}
      </Stack>
    </Stack>
  );
};
