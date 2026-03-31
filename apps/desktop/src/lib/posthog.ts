import * as Sentry from "@sentry/electron/renderer";
import posthog from "posthog-js/dist/module.full.no-external";

posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY, {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  capture_pageview: false,
  capture_pageleave: false,
  defaults: "2026-01-30",
  debug: import.meta.env.DEV,
});

Sentry.getCurrentScope().setTag("posthog_session_id", posthog.get_session_id());

export { posthog };
