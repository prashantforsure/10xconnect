import { env } from "@10xconnect/config";
import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

/**
 * Verifies a shared secret on inbound provider webhooks (Unipile notify_url,
 * payments). The secret arrives either as an `x-webhook-secret` header or a
 * `?secret=…` query param (we append it to the notify_url we hand the provider).
 *
 * Fail-open when unconfigured: if WEBHOOK_SECRET is unset the guard allows the
 * request, so local dev + the mock adapter (which simulate these callbacks)
 * keep working. In production, set WEBHOOK_SECRET and the guard fails closed.
 */
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = env.WEBHOOK_SECRET;
    if (!expected) {
      return true;
    }
    const req = context.switchToHttp().getRequest<{
      headers?: Record<string, unknown>;
      query?: Record<string, unknown>;
    }>();
    const headerVal = req.headers?.["x-webhook-secret"];
    const queryVal = req.query?.secret;
    const provided = typeof headerVal === "string" ? headerVal : typeof queryVal === "string" ? queryVal : "";
    if (provided !== expected) {
      throw new UnauthorizedException("Invalid or missing webhook secret");
    }
    return true;
  }
}
