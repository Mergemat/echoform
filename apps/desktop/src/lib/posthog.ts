import * as Sentry from "@sentry/electron/renderer";
import posthog from "posthog-js/dist/module.full.no-external";

posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY, {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  autocapture: false,
  capture_pageview: false,
  capture_pageleave: false,
  capture_performance: false,
  defaults: "2026-01-30",
  debug: import.meta.env.DEV,
});

function getAppContextProps() {
  if (typeof window === "undefined") {
    return {};
  }

  return {
    api_base_url: window.echoform?.apiBaseUrl,
    app_version: window.echoform?.runtime?.appVersion,
    arch: window.echoform?.runtime?.arch,
    electron_version: window.echoform?.runtime?.electronVersion,
    platform: window.echoform?.runtime?.platform,
  };
}

let lastProfileProperties: Record<string, number> | null = null;

export function syncAppProfile(properties: Record<string, number>) {
  const nextProfile = Object.fromEntries(
    Object.entries(properties).sort(([left], [right]) => left.localeCompare(right))
  );

  if (
    lastProfileProperties &&
    JSON.stringify(lastProfileProperties) === JSON.stringify(nextProfile)
  ) {
    return;
  }

  lastProfileProperties = nextProfile;
  posthog.setPersonProperties(nextProfile);
}

if (typeof window !== "undefined") {
  posthog.register(getAppContextProps());
}

Sentry.getCurrentScope().setTag("posthog_session_id", posthog.get_session_id());

export { posthog };
