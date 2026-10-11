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