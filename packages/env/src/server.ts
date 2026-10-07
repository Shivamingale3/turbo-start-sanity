import { createEnv } from "@t3-oss/env-nextjs";
import { vercel } from "@t3-oss/env-nextjs/presets-zod";
import { z } from "zod/v4";

const env = createEnv({
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },

  server: {
    SANITY_API_READ_TOKEN: z.string().min(1),
    SANITY_API_WRITE_TOKEN: z.string().min(1),
    // Shared secret for the `/api/revalidate-sync-tags` webhook. Optional so
    // existing deployments still boot; the webhook fails closed when unset.
    SANITY_REVALIDATE_SECRET: z.string().min(1).optional(),
    // FAQ ask box; `/api/ask` returns 503 until both are set.
    SANITY_CONTEXT_ENDPOINT: z.url().optional(),
    SANITY_CONTEXT_TOKEN: z.string().min(1).optional(),

    // Algolia sync webhook. Route fails closed (401) when unset.
    SANITY_ALGOLIA_WEBHOOK_SECRET: z.string().min(1).optional(),

    // Algolia search index. Search falls back to GROQ and the sync
    // webhook returns 503 when these are unset.
    ALGOLIA_APP_ID: z.string().min(1).optional(),
    ALGOLIA_SEARCH_API_KEY: z.string().min(1).optional(),
    ALGOLIA_WRITE_API_KEY: z.string().min(1).optional(),
    ALGOLIA_INDEX_NAME: z.string().min(1).optional(),

    // Upstash Redis for rate limiting. Falls back to a bounded per-instance
    // in-memory limiter when unset or unreachable.
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  },

  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
  },

  // Treat empty env strings (e.g. `SANITY_REVALIDATE_SECRET=` in .env.example)
  // as unset, so `.optional()` vars don't fail `.min(1)` on a blank value.
  emptyStringAsUndefined: true,

  extends: [vercel()],
});

export { env };
