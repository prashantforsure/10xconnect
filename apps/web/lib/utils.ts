import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Return `url` only if it is a safe http(s) link, else undefined — so a stored
 * `javascript:`/`data:` URL is never rendered as a live `href` (XSS). Defense in
 * depth alongside the server-side linkedin.com allowlist; also guards legacy rows
 * persisted before that validation existed.
 */
export function safeHttpUrl(url: string | null | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

/**
 * Route an external avatar URL through our backend image proxy so LinkedIn CDN
 * photos (which 403 on browser hotlink) render. Returns undefined for empty /
 * unsafe URLs so the caller shows an initials fallback. Only https URLs on the
 * proxy's allowlist actually resolve; anything else 400s and falls back.
 */
export function proxiedAvatarSrc(url: string | null | undefined): string | undefined {
  const safe = safeHttpUrl(url);
  if (!safe) {
    return undefined;
  }
  return `${API_BASE}/media/avatar?url=${encodeURIComponent(safe)}`;
}
