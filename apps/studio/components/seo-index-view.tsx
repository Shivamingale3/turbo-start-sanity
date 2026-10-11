import { Card, Stack, Text } from "@sanity/ui";
import type { UserViewComponent } from "sanity/structure";

import {
  DESCRIPTION_MAX,
  getEffectiveSeo,
  type SeoDocument,
  TITLE_MAX,
  truncate,
} from "@/utils/seo-checks";

const titleStyle = { color: "var(--card-link-color)" } as const;

/**
 * Read-only "SEO & Index" tab for blog posts. `displayed` is the live draft
 * (or the published version when there is no draft), so the preview updates
 * as the editor types.
 */
export const SeoIndexView: UserViewComponent = ({ document }) => {
  const seo = getEffectiveSeo(document.displayed as SeoDocument);

  return (
    <Stack gap={4} padding={4}>
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
  );
};