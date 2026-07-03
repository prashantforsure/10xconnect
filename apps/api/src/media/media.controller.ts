import { Controller, Get, Query, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";

import { Public } from "../common/decorators/public.decorator";

// Hosts we will proxy avatar images from. LinkedIn's CDN (media*.licdn.com) 403s
// on direct browser hotlinks (no referrer / expiring token), so the app renders
// initials instead of the real photo. Fetching server-side — with a linkedin.com
// referer — sidesteps that. i.pravatar.cc is the mock adapter's avatar source.
// The allowlist is the SSRF guard: we never fetch an arbitrary caller-supplied URL.
const ALLOWED_HOST = /(^|\.)(licdn\.com|pravatar\.cc)$/;
const MAX_BYTES = 5_000_000; // 5MB — an avatar is a few KB; this just caps abuse.
const FETCH_TIMEOUT_MS = 5000;

/**
 * Public avatar image proxy (`GET /api/v1/media/avatar?url=…`). Streams a
 * whitelisted remote avatar back through our origin so LinkedIn CDN photos load
 * despite hotlink protection, with a long cache. Returns 400/404 on a bad or
 * unreachable URL so the client's <img onError> falls back to initials.
 */
@Controller("media")
export class MediaController {
  @Public()
  @SkipThrottle()
  @Get("avatar")
  async avatar(@Query("url") rawUrl: string | undefined, @Res() res: Response): Promise<void> {
    const target = parseAllowed(rawUrl);
    if (!target) {
      res.status(400).end();
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const upstream = await fetch(target, {
        signal: controller.signal,
        headers: {
          // A LinkedIn media URL only serves with a linkedin.com referer.
          referer: "https://www.linkedin.com/",
          "user-agent": "Mozilla/5.0 (compatible; 10xConnect-avatar-proxy)",
        },
      });
      if (!upstream.ok || !upstream.body) {
        res.status(404).end();
        return;
      }
      const contentType = upstream.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) {
        res.status(415).end();
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) {
        res.status(413).end();
        return;
      }
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", buf.byteLength);
      // Avatars are stable + public: cache hard, and allow the cross-origin web
      // app to render the bytes (helmet defaults CORP to same-origin).
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.status(200).send(buf);
    } catch {
      res.status(404).end();
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Return the URL only if it is an https URL on an allowlisted host, else null. */
function parseAllowed(rawUrl: string | undefined): string | null {
  if (!rawUrl || rawUrl.length > 2000) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  return ALLOWED_HOST.test(parsed.hostname.toLowerCase()) ? parsed.toString() : null;
}
