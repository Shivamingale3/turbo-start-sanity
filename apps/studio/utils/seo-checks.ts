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
  pass: boolean;
  tone: CheckTone;
  message: string;
};

function pass(id: string, message: string): SeoCheck {
  return { id, pass: true, tone: "positive", message };
}

function fail(id: string, tone: CheckTone, message: string): SeoCheck {
  return { id, pass: false, tone, message };
}

/**
 * The four checks, always in the same order, each pass or fail with its
 * reason and the live character count. They run on the draft the editor is
 * typing in. Missing title is the only error, because Google then invents
 * one. Length and image issues are warnings. Do Not Index is a deliberate
 * choice, so it shows as a fail in grey rather than red.
 */
export function getSeoChecks(doc: SeoDocument): SeoCheck[] {
  const seo = getEffectiveSeo(doc);
  const titleLength = seo.title.length;
  const descriptionLength = seo.description.length;

  let title: SeoCheck;
  if (titleLength === 0) {
    title = fail(
      "title",
      "critical",
      "Meta title missing. Google will make one up from the page."
    );
  } else if (titleLength > TITLE_MAX) {
    title = fail(
      "title",
      "caution",
      `Meta title too long: ${titleLength} characters. Google cuts at about ${TITLE_MAX}.`
    );
  } else {
    title = pass("title", `Meta title set: ${titleLength} characters`);
  }

  let description: SeoCheck;
  if (descriptionLength === 0) {
    description = fail(
      "description",
      "caution",
      "Description missing. Google will pick text from the page."
    );
  } else if (descriptionLength < DESCRIPTION_MIN) {
    description = fail(
      "description",
      "caution",
      `Description too short: ${descriptionLength} characters. Aim for ${DESCRIPTION_MIN} to ${DESCRIPTION_MAX}.`
    );
  } else if (descriptionLength > DESCRIPTION_MAX) {
    description = fail(
      "description",
      "caution",
      `Description too long: ${descriptionLength} characters. Aim for ${DESCRIPTION_MIN} to ${DESCRIPTION_MAX}.`
    );
  } else {
    description = pass(
      "description",
      `Description length good: ${descriptionLength} characters`
    );
  }

  const image = seo.hasImage
    ? pass("image", "Image set")
    : fail(
        "image",
        "caution",
        "No image. Shared links will show without a picture."
      );

  const indexing =
    doc.seoNoIndex === true
      ? fail("indexing", "default", "Indexing blocked: Do Not Index is on")
      : pass("indexing", "Indexing allowed");

  return [title, description, image, indexing];
}

/**
 * The URL line of the preview, the way Google shows it:
 * "site.com › blog › my-post". The host comes from the production URL the
 * Studio is configured with, so the preview points at the real site.
 */
export function toBreadcrumb(
  siteUrl: string | undefined,
  path: string
): string {
  let host = "yoursite.com";
  if (siteUrl && URL.canParse(siteUrl)) {
    host = new URL(siteUrl).host;
  }
  const parts = path.split("/").filter(Boolean);
  return [host, ...parts].join(" › ");
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