import { Card, Flex, Stack, Text } from "@sanity/ui";
import type { UserViewComponent } from "sanity/structure";

import {
  type CheckTone,
  DESCRIPTION_MAX,
  getEffectiveSeo,
  getSeoChecks,
  type SeoDocument,
  TITLE_MAX,
  truncate,
} from "@/utils/seo-checks";

const titleStyle = { color: "var(--card-link-color)" } as const;

// Same text colours as components/url-slug/validation-messages.tsx, so the
// tab matches the warnings editors already see on the slug field.
const toneTextStyle: Partial<Record<CheckTone, { color: string }>> = {
  critical: { color: "var(--card-badge-critical-fg-color)" },
  caution: { color: "var(--card-badge-caution-fg-color)" },
  positive: { color: "var(--card-badge-positive-fg-color)" },
};

/**
 * Read-only "SEO & Index" tab for blog posts. `displayed` is the live draft
 * (or the published version when there is no draft), so the preview and the
 * checks update as the editor types.
 */
export const SeoIndexView: UserViewComponent = ({ document }) => {
  const draft = document.displayed as SeoDocument;
  const seo = getEffectiveSeo(draft);
  const checks = getSeoChecks(draft);

  return (
    <Stack gap={5} padding={4}>
      <Stack gap={3}>
        <Text size={1} weight="semibold">
          SEARCH PREVIEW
        </Text>
        <Card border padding={4} radius={2}>
          <Stack gap={3}>
            <Text size={3} style={titleStyle}>
              {truncate(seo.title || "Untitled", TITLE_MAX)}
            </Text>
            <Text muted size={1}>
              {seo.path || "/blog/…"}
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
        <Flex align="center" gap={2}>
          <Text size={1} weight="semibold">
            SEO CHECKS
          </Text>
          <Text muted size={1}>
            from your draft
          </Text>
        </Flex>
        <Stack gap={2}>
          {checks.map((check) => (
            <Card key={check.id} padding={3} radius={2} tone={check.tone}>
              <Text size={1} style={toneTextStyle[check.tone]}>
                {check.message}
              </Text>
            </Card>
          ))}
        </Stack>
      </Stack>
    </Stack>
  );
};