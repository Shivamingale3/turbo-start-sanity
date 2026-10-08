"use client";

import {
  type NewsletterStatus,
  SubscribeNewsletter,
  type SubscribeNewsletterProps,
} from "@workspace/sanity-blocks/subscribe-newsletter/index";
import { useEffect, useState } from "react";

import {
  HONEYPOT_FIELD,
  isOutcome,
  MESSAGE,
  NEWSLETTER_ENDPOINT,
  type Outcome,
} from "@/lib/newsletter-shared";

// Content props come from Sanity. Everything about submitting is ours.
type NewsletterSignupProps = Omit<
  SubscribeNewsletterProps,
  "action" | "method" | "onSubmit" | "honeypotName" | "pending" | "status"
>;

function toStatus(outcome: Outcome, message: string): NewsletterStatus {
  return { tone: outcome === "subscribed" ? "success" : "error", message };
}

/**
 * Progressive enhancement around the newsletter block. The form always has
 * a real action, so a submit before hydration still posts natively and the
 * route redirects back here. Once JS runs, submits go through fetch and the
 * outcome shows inline without leaving the page.
 */
export function NewsletterSignup(props: Readonly<NewsletterSignupProps>) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<NewsletterStatus | null>(null);

  // Landed here from the no-JS redirect (?newsletter=<outcome>): show it.
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get(
      "newsletter"
    );
    if (outcome && isOutcome(outcome)) {
      setStatus(toStatus(outcome, MESSAGE[outcome]));
    }
  }, []);

  // Typed from the block's own onSubmit prop, so it always matches the
  // installed React types.
  const handleSubmit: NonNullable<
    SubscribeNewsletterProps["onSubmit"]
  > = async (event) => {
    event.preventDefault();
    if (pending) {
      return;
    }
    // Read before any await: React clears currentTarget after the handler.
    const form = event.currentTarget;
    setPending(true);
    setStatus(null);
    try {
      // FormData sends multipart/form-data, the same shape a native post has.
      const response = await fetch(NEWSLETTER_ENDPOINT, {
        method: "POST",
        headers: { accept: "application/json" },
        body: new FormData(form),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
      };
      setStatus({
        tone: result.ok ? "success" : "error",
        message: result.message ?? MESSAGE.error,
      });
      if (result.ok) {
        form.reset();
      }
    } catch {
      setStatus(toStatus("error", MESSAGE.error));
    } finally {
      setPending(false);
    }
  };

  return (
    <SubscribeNewsletter
      {...props}
      action={NEWSLETTER_ENDPOINT}
      honeypotName={HONEYPOT_FIELD}
      method="post"
      onSubmit={handleSubmit}
      pending={pending}
      status={status}
    />
  );
}
