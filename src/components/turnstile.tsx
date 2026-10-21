"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useActionFormState } from "@/components/action-form";
import { watchTurnstileReady } from "@/lib/turnstile-ready";

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: Record<string, string | number | boolean>,
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Cloudflare Turnstile widget. The token is submitted as `captchaToken` and
 * forwarded to Supabase Auth, which validates it with the secret configured
 * in the Supabase dashboard. Rendered only when a site key is configured.
 */
export function Turnstile({
  siteKey,
  nonce,
}: {
  siteKey: string;
  nonce?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  // Already loaded when returning to the page through client navigation.
  const [ready, setReady] = useState(
    () => typeof window !== "undefined" && !!window.turnstile,
  );
  const form = useActionFormState();
  const result = form?.state;

  // A second widget on the same page never gets onReady from next/script
  // (the script is loaded once), so also watch for window.turnstile (R-03).
  useEffect(() => {
    if (ready) return;
    return watchTurnstileReady(
      () => !!window.turnstile,
      () => setReady(true),
    );
  }, [ready]);

  useEffect(() => {
    const api = window.turnstile;
    if (!ready || !api || !container.current || widget.current) return;
    widget.current = api.render(container.current, {
      sitekey: siteKey,
      "response-field-name": "captchaToken",
      language: "es",
      theme: "light",
    });
    return () => {
      if (widget.current) api.remove(widget.current);
      widget.current = null;
    };
  }, [ready, siteKey]);

  // Tokens are single-use: request a new one after every server answer.
  useEffect(() => {
    if (
      (result?.error || result?.success) &&
      widget.current &&
      window.turnstile
    )
      window.turnstile.reset(widget.current);
  }, [result]);

  return (
    <>
      <Script
        src={TURNSTILE_SCRIPT}
        strategy="afterInteractive"
        nonce={nonce}
        onReady={() => setReady(true)}
        onLoad={() => setReady(true)}
      />
      <div ref={container} className="min-h-[65px]" />
    </>
  );
}
