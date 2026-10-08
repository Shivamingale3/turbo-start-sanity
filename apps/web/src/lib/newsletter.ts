// Pure helpers for /api/newsletter. No env, no Sanity client, no network,
// so they can be unit tested without secrets.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

// RFC 5321 caps a full email address at 254 characters.
export const MAX_EMAIL_LENGTH = 254;

// Hidden field humans never see. Bots that fill every input fill this too.
export const HONEYPOT_FIELD = "website";

// Every way the route can end. Each maps to a status (JSON mode) and a
// ?newsletter= value (redirect mode).
export type Outcome =
  | "subscribed"
  | "invalid"
  | "too-large"
  | "unsupported"
  | "limited"
  | "error";

export type ParsedBody = { email: unknown; honeypot: unknown };

export type RespondOptions = {
  wantsJson: boolean;
  backTo: string;
  requestUrl: string;
  retryAfter?: number;
};

export const STATUS: Record<Outcome, number> = {
  subscribed: 200,
  invalid: 400,
  "too-large": 413,
  unsupported: 415,
  limited: 429,
  error: 503,
};

// User-facing text only. Never internals, never whether the email existed.
export const MESSAGE: Record<Outcome, string> = {
  subscribed: "You're subscribed.",
  invalid: "Enter a valid email address.",
  "too-large": "Request too large.",
  unsupported: "Unsupported content type.",
  limited: "Too many attempts. Please try again later.",
  error: "Something went wrong. Please try again later.",
};

/** Reads form data (native browser post) or JSON (fetch). */
export async function parseBody(
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
export function normalizeEmail(value: unknown): string | null {
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
export function subscriberId(email: string): string {
  return `subscriber.${createHash("sha256").update(email).digest("hex")}`;
}

/**
 * Path of the page the form was posted from, only if it's our own site.
 * Used as the redirect target, so it must never be a URL the client chose,
 * or this becomes an open redirect.
 */
export function sameOriginPath(request: Request): string {
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
export function respond(outcome: Outcome, options: RespondOptions): Response {
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
