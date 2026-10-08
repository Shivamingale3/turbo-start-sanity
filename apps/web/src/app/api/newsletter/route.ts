import { env } from "@workspace/env/server";
import { Logger } from "@workspace/logger";
import { client } from "@workspace/sanity/client";

import {
  normalizeEmail,
  parseBody,
  respond,
  sameOriginPath,
  subscriberId,
} from "@/lib/newsletter";
import { clientKey, rateLimit } from "@/lib/rate-limit";

const logger = new Logger("Newsletter");

// Bounded work: a signup body is a few hundred bytes, anything near 10 KB
// is not a real form. Trusts content-length; Vercel also caps bodies.
const MAX_BODY_BYTES = 10 * 1024;

// 5 tries per 10 min per IP: room for typos, too slow for a script.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

// Same pattern as api/presentation-draft, but with the write token.
// Server-only: this module never ships to the browser.
const writeClient = client.withConfig({
  token: env.SANITY_API_WRITE_TOKEN,
  useCdn: false,
});

export async function POST(request: Request) {
  // fetch() from our form sends Accept: application/json; a native form
  // post (no JS) does not, so it gets a redirect back to the page instead.
  const wantsJson = (request.headers.get("accept") ?? "").includes(
    "application/json"
  );
  const options = {
    wantsJson,
    backTo: sameOriginPath(request),
    requestUrl: request.url,
  };

  try {
    // Rate limit first: the cheapest check protects everything after it.
    const limit = await rateLimit({
      key: clientKey(request, "newsletter"),
      limit: RATE_LIMIT,
      windowMs: RATE_WINDOW_MS,
    });
    if (!limit.allowed) {
      return respond("limited", {
        ...options,
        retryAfter: limit.retryAfterSeconds,
      });
    }

    const contentLength = Number.parseInt(
      request.headers.get("content-length") ?? "0",
      10
    );
    if (contentLength > MAX_BODY_BYTES) {
      return respond("too-large", options);
    }

    const body = await parseBody(request);
    if (body === "unsupported" || body === "invalid") {
      return respond(body, options);
    }

    // Answer exactly like a real signup so the bot learns nothing.
    if (typeof body.honeypot === "string" && body.honeypot !== "") {
      logger.info("Honeypot triggered, nothing written", {
        source: options.backTo,
      });
      return respond("subscribed", options);
    }

    const email = normalizeEmail(body.email);
    if (!email) {
      return respond("invalid", options);
    }

    await saveSubscriber(email, options.backTo);
    // Same response for new and existing emails, so the endpoint can't be
    // used to check who is on the list.
    return respond("subscribed", options);
  } catch (error) {
    // Name only: no email, no raw message from the Sanity client.
    logger.error("Subscribe failed", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return respond("error", options);
  }
}

/** Creates the subscriber once; signing up again clears an opt-out. */
async function saveSubscriber(email: string, source: string): Promise<void> {
  const id = subscriberId(email);
  // One transaction: both mutations apply together or not at all.
  await writeClient
    .transaction()
    .createIfNotExists({
      _id: id,
      _type: "subscriber",
      email,
      subscribedAt: new Date().toISOString(),
      source,
      optedOut: false,
    })
    .patch(id, (patch) => patch.set({ optedOut: false }).unset(["optedOutAt"]))
    .commit();
}
