import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) {
    return "Never";
  }
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Replace the home directory with ~ and the iCloud Drive container with ~/iCloud. */
export function shortenPath(path: string): string {
  let short = path;
  const parts = short.split("/");
  if (parts.length >= 3 && (parts[1] === "Users" || parts[1] === "home")) {
    const home = `/${parts[1]}/${parts[2]}`;
    if (short === home) {
      return "~";
    }
    if (short.startsWith(`${home}/`)) {
      short = `~${short.slice(home.length)}`;
    }
  }
  return short.replace(
    "~/Library/Mobile Documents/com~apple~CloudDocs",
    "~/iCloud"
  );
}

export function plural(count: number, noun: string, pluralNoun = `${noun}s`) {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}
