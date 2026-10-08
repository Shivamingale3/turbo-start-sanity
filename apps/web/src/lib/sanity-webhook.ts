// Verifies Sanity webhook signatures. Replaces next-sanity's parseBody,
// whose underlying @sanity/webhook compares signatures with `!==` and
// returns null (not false) when the secret is missing.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SANITY_SIGNATURE_HEADER = "sanity-webhook-signature";

// Sanity's header format: "t=<unix ms>,v1=<base64url HMAC-SHA256>".
const SIGNATURE_HEADER_REGEX = /^t=(\d+)[, ]+v1=([^, ]+)$/;

// Hash both sides to a fixed 32 bytes before comparing, so timingSafeEqual
// never sees different lengths and the compare leaks neither the content
// nor the length of the expected signature.
function constantTimeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * True only if the signature was made with our secret over this exact body.
 * Never throws: anything missing or malformed is false, so the route can
 * fail closed with a single check.
 *
 * No timestamp age check: replaying a delivery only re-syncs the current
 * state of that document, which is harmless (see NOTES.md).
 */
export function isValidSanitySignature({
  rawBody,
  signatureHeader,
  secret,
}: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string | undefined;
}): boolean {
  if (!(secret && signatureHeader && rawBody)) {
    return false;
  }

  const match = signatureHeader.trim().match(SIGNATURE_HEADER_REGEX);
  if (!match) {
    return false;
  }
  const [, timestamp, providedSignature] = match;
  if (!(timestamp && providedSignature)) {
    return false;
  }

  // Signed payload is "<timestamp>.<raw body>". The timestamp is in a
  // header but still covered, because it is part of the HMAC input.
  const expectedSignature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("base64url");

  return constantTimeEqual(providedSignature, expectedSignature);
}
