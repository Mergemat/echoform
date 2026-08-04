import * as Sentry from "@sentry/electron/renderer";
import posthogJs from "posthog-js/dist/module.full.no-external";

const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY?.trim();
const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST?.trim();

export const analyticsEnabled = Boolean(posthogKey && posthogHost);

if (analyticsEnabled) {
  posthogJs.init(posthogKey, {
    api_host: posthogHost,
    autocapture: false,
    capture_pageleave: false,
    capture_pageview: false,
    capture_performance: false,
    debug: import.meta.env.DEV,
    defaults: "2026-01-30",
  });
}

type AnalyticsValue = boolean | null | number | string | undefined;
type AnalyticsProperties = Record<string, AnalyticsValue>;

function cleanProperties(properties: AnalyticsProperties) {
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([, value]) => value !== undefined && value !== ""
    )
  );
}

function getAppContextProps() {
  if (typeof window === "undefined") {
    return {};
  }

  return cleanProperties({
    api_base_url: window.echoform?.apiBaseUrl,
    app_version: window.echoform?.runtime?.appVersion,
    arch: window.echoform?.runtime?.arch,
    electron_version: window.echoform?.runtime?.electronVersion,
    platform: window.echoform?.runtime?.platform,
  });
}

function refreshAppContext() {
  if (!analyticsEnabled || typeof window === "undefined") {
    return;
  }

  const props = getAppContextProps();
  if (Object.keys(props).length === 0) {
    return;
  }

  posthogJs.register(props);
}

let lastProfileProperties: Record<string, AnalyticsValue> | null = null;

export function syncAppProfile(properties: AnalyticsProperties) {
  if (!analyticsEnabled) {
    return;
  }

  refreshAppContext();

  const nextProfile = Object.fromEntries(
    Object.entries(cleanProperties(properties)).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );

  if (
    lastProfileProperties &&
    JSON.stringify(lastProfileProperties) === JSON.stringify(nextProfile)
  ) {
    return;
  }

  lastProfileProperties = nextProfile;
  posthogJs.setPersonProperties(nextProfile);
}

function capture(event: string, properties: AnalyticsProperties = {}) {
  if (!analyticsEnabled) {
    return;
  }

  refreshAppContext();
  posthogJs.capture(event, cleanProperties(properties));
}

if (analyticsEnabled && typeof window !== "undefined") {
  refreshAppContext();
}

const posthogSessionId = analyticsEnabled ? posthogJs.get_session_id() : null;
if (posthogSessionId) {
  Sentry.getCurrentScope().setTag("posthog_session_id", posthogSessionId);
}

export const posthog = {
  capture,
  get_session_id() {
    return analyticsEnabled ? posthogJs.get_session_id() : null;
  },
};
