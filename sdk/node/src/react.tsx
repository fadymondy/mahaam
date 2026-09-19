"use client";
import { useEffect } from "react";
import { resolveConfig, type FeedbackConfig } from "./index.js";

/** `key` is reserved by React, so the public key is passed as `publicKey`. */
export type MahaamFeedbackProps = Omit<FeedbackConfig, "key"> & { publicKey?: string };

/**
 * Loads the Mahaam Feedback widget once on the client. Works in React and
 * Next.js (client component). Pass `publicKey` (in Next use a NEXT_PUBLIC_* env var).
 */
export function MahaamFeedback(props: MahaamFeedbackProps) {
  const { publicKey, ...rest } = props;
  const c = resolveConfig({ ...rest, key: publicKey });
  useEffect(() => {
    if (!c.enabled || typeof document === "undefined") return;
    const src = `${c.baseUrl}/embed/v1.js`;
    if (document.querySelector(`script[data-mahaam-feedback]`)) return;
    const s = document.createElement("script");
    s.src = src;
    s.defer = true;
    s.dataset.key = c.key;
    s.dataset.locale = c.locale;
    s.dataset.mahaamFeedback = "";
    if (c.endpoint) s.dataset.endpoint = c.endpoint;
    document.body.appendChild(s);
  }, [c.enabled, c.baseUrl, c.key, c.locale, c.endpoint]);
  return null;
}

/** Pre-rebrand name, kept so existing imports keep working. */
export const ManagyFeedback = MahaamFeedback;
export type ManagyFeedbackProps = MahaamFeedbackProps;

export default MahaamFeedback;
