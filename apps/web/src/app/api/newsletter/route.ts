import { createHash } from "node:crypto";
import { env } from "@workspace/env/server";
import { Logger } from "@workspace/logger";
import { client } from "@workspace/sanity/client";
import { NextResponse } from "next/server";

import { clientKey, rateLimit } from "@/lib/rate-limit";

const logger = new Logger("Newsletter");

// Bounded work: a signup body is a few hundred bytes, anything near 10 KB
// is not a real form. Trusts content-length; Vercel also caps bodies.
const MAX_BODY_BYTES = 10 * 1024;

// RFC 5321 caps a full email address at 254 characters.
const MAX_EMAIL_LENGTH = 254;

// 5 tries per 10 min per IP: room for typos, too slow for a script.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

// Hidden field humans never see. Bots that fill every input fill this too.
const HONEYPOT_FIELD = "website";

// Same pattern as api/presentation-draft, but with the write token.
// Server-only: this module never ships to the browser.
const writeClient = client.withConfig({
  token: env.SANITY_API_WRITE_TOKEN,
  useCdn: false,
});

// Every way the route can end. Each maps to a status (JSON mode) and a
// ?newsletter= value (redirect mode).
type Outcome =
  | "subscribed"
  | "invalid"
  | "too-large"
  | "unsupported"
  | "limited"
  | "error";

type ParsedBody = { email: unknown; honeypot: unknown };

type RespondOptions = {
  wantsJson: boolean;
  backTo: string;
  requestUrl: string;
  retryAfter?: number;
};

const STATUS: Record<Outcome, number> = {
  subscribed: 200,
  invalid: 400,
  "too-large": 413,
  unsupported: 415,
  limited: 429,
  error: 503,
};

// User-facing text only. Never internals, never whether the email existed.
const MESSAGE: Record<Outcome, string> = {
  subscribed: "You're subscribed.",
  invalid: "Enter a valid email address.",
  "too-large": "Request too large.",
  unsupported: "Unsupported content type.",
  limited: "Too many attempts. Please try again later.",
  error: "Something went wrong. Please try again later.",
};

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

/** Reads form data (native browser post) or JSON (fetch). */
async function parseBody(
  request: Request
): Promise<ParsedBody | "unsupported" | "invalid"> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    // Covers both multipart/form-data and application/x-www-form-urlencoded.
    if (contentType.includes("form")) {
      const form = await request.formData();
      return { email: form.get("email"), honeypot: form.get(HONEYPOT_FIELD) };
    }
    if (contentType.includes("application/json")) {
      const json: unknown = await request.json();
      if (!json || typeof json !== "object") {
        return "invalid";
      }
      const fields = json as Record<string, unknown>;
      return { email: fields.email, honeypot: fields[HONEYPOT_FIELD] };
    }
    return "unsupported";
  } catch {
    return "invalid";
  }
}

/**
 * Trimmed, lowercased email, or null if it isn't a plausible address.
 * Sanity's Rule.email() only runs in Studio, not on API writes, so the
 * route has to validate itself.
 */
function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) {
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

/**
 * Deterministic: the same email always maps to the same _id, so a repeat
 * signup can't create a second document. The dot puts it on a sub-path,
 * which a public dataset never serves without a token. Full hash, no
 * truncation, so two different emails can't collide.
 */
function subscriberId(email: string): string {
  return `subscriber.${createHash("sha256").update(email).digest("hex")}`;
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

/**
 * Path of the page the form was posted from, only if it's our own site.
 * Used as the redirect target, so it must never be a URL the client chose,
 * or this becomes an open redirect.
 */
function sameOriginPath(request: Request): string {
  const referer = request.headers.get("referer");
  if (!referer) {
    return "/";
  }
  try {
    const from = new URL(referer);
    if (from.origin !== new URL(request.url).origin) {
      return "/";
    }
    return from.pathname.slice(0, 200);
  } catch {
    return "/";
  }
}

/** JSON with a real status for fetch, or a 303 back to the page for forms. */
function respond(outcome: Outcome, options: RespondOptions): Response {
  if (options.wantsJson) {
    const headers = new Headers();
    if (options.retryAfter) {
      headers.set("Retry-After", String(options.retryAfter));
    }
    return NextResponse.json(
      { ok: outcome === "subscribed", message: MESSAGE[outcome] },
      { status: STATUS[outcome], headers }
    );
  }

  // 303 = Post/Redirect/Get: the browser lands back on the page with a GET,
  // and refreshing doesn't re-submit the form.
  const target = new URL(options.backTo, options.requestUrl);
  target.searchParams.set("newsletter", outcome);
  return NextResponse.redirect(target, 303);
}
