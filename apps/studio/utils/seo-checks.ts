// Pure helpers for the "SEO & Index" tab. No React here, so each rule can be
// read and explained on its own.

/** The blog fields the tab reads. Every field is optional in a draft. */
export type SeoDocument = {
  title?: string;
  description?: string;
  slug?: { current?: string };
  image?: { asset?: { _ref?: string } };
  seoTitle?: string;
  seoDescription?: string;
  seoImage?: { asset?: { _ref?: string } };
  seoNoIndex?: boolean;
  seoHideFromLists?: boolean;
};

// Google cuts titles by pixel width (about 600px), which is roughly 60
// characters of average text. The preview truncates at the same point.
export const TITLE_MAX = 60;
// Same 140 to 160 rule the blog schema warns on for `description`.
export const DESCRIPTION_MIN = 140;
export const DESCRIPTION_MAX = 160;

/** The values Google would see, after the seo-fields.ts fallbacks. */
export type EffectiveSeo = {
  title: string;
  description: string;
  path: string;
  hasImage: boolean;
};

export function getEffectiveSeo(doc: SeoDocument): EffectiveSeo {
  return {
    title: (doc.seoTitle || doc.title || "").trim(),
    description: (doc.seoDescription || doc.description || "").trim(),
    path: doc.slug?.current ?? "",
    hasImage: Boolean(doc.seoImage?.asset?._ref || doc.image?.asset?._ref),
  };
}

/** Cuts text to max characters, adding an ellipsis when it was longer. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Card tones from @sanity/ui: red, yellow, grey and green. */
export type CheckTone = "critical" | "caution" | "default" | "positive";

export type SeoCheck = {
  id: string;
  tone: CheckTone;
  message: string;
};

/**
 * Checks run on the draft the editor is typing in. Missing title is the only
 * error, because Google then invents one. Length and image issues are
 * warnings. Do Not Index is a deliberate choice, so it is only info.
 */
export function getSeoChecks(doc: SeoDocument): SeoCheck[] {
  const seo = getEffectiveSeo(doc);
  const checks: SeoCheck[] = [];

  if (!seo.title) {
    checks.push({
      id: "title-missing",
      tone: "critical",
      message: "Title is missing. Google will make one up from the page.",
    });
  } else if (seo.title.length > TITLE_MAX) {
    checks.push({
      id: "title-long",
      tone: "caution",
      message: `Title is ${seo.title.length} characters. Google cuts titles at about ${TITLE_MAX}.`,
    });
  }

  const length = seo.description.length;
  if (length === 0) {
    checks.push({
      id: "description-missing",
      tone: "caution",
      message: "Description is missing. Google will pick text from the page.",
    });
  } else if (length < DESCRIPTION_MIN || length > DESCRIPTION_MAX) {
    checks.push({
      id: "description-length",
      tone: "caution",
      message: `Description is ${length} characters. Aim for ${DESCRIPTION_MIN} to ${DESCRIPTION_MAX}.`,
    });
  }

  if (!seo.hasImage) {
    checks.push({
      id: "image-missing",
      tone: "caution",
      message: "No image set. Shared links will show without a picture.",
    });
  }

  if (doc.seoNoIndex === true) {
    checks.push({
      id: "no-index",
      tone: "default",
      message:
        "Do Not Index is on. Search engines and site search will skip this post.",
    });
  }

  if (checks.length === 0) {
    checks.push({
      id: "all-good",
      tone: "positive",
      message: "All SEO checks pass.",
    });
  }

  return checks;
}

/**
 * Why a published post would be kept out of search, or null when it belongs
 * there. Mirrors isIndexable() in apps/web/src/lib/blog-search-record.ts,
 * which the sync webhook and backfill use. Keep the two in step.
 */
export function getIndexBlocker(doc: SeoDocument): string | null {
  if (!doc.title) {
    return "it has no title";
  }
  if (!doc.slug?.current) {
    return "it has no slug";
  }
  if (doc.seoNoIndex === true) {
    return "Do Not Index is on";
  }
  if (doc.seoHideFromLists === true) {
    return "Hide From Lists is on";
  }
  return null;
}