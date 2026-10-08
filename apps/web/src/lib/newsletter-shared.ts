// Shared by the route (server) and the signup form (browser). Keep it free
// of server-only imports such as node:crypto, so it can ship to the client.

export const NEWSLETTER_ENDPOINT = "/api/newsletter";

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

// User-facing text only. Never internals, never whether the email existed.
export const MESSAGE: Record<Outcome, string> = {
  subscribed: "You're subscribed.",
  invalid: "Enter a valid email address.",
  "too-large": "Request too large.",
  unsupported: "Unsupported content type.",
  limited: "Too many attempts. Please try again later.",
  error: "Something went wrong. Please try again later.",
};

/** Narrows an untrusted string (e.g. a URL param) to a known outcome. */
export function isOutcome(value: string): value is Outcome {
  // hasOwn, not `in`: "toString" in MESSAGE would be true via the prototype.
  return Object.hasOwn(MESSAGE, value);
}
