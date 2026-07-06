import "reflect-metadata";

import { assertProductionEnv, env } from "@10xconnect/config";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";

import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  // Refuse to boot in production without the critical secrets (fail fast, not at
  // first-use). No-op in dev/test. "api": also requires SUPABASE_JWT_SECRET.
  assertProductionEnv("api");

  const app = await NestFactory.create(AppModule);
  // Security headers (HSTS, no-sniff, frameguard, etc.). This is a JSON API + a
  // couple of redirects, so helmet's defaults are safe as-is.
  app.use(helmet());
  // CORS: only the app origin may call the API with credentials.
  app.enableCors({ origin: env.APP_URL, credentials: true });
  // All API routes are under /api/v1 (CLAUDE.md §8); /health stays at the root.
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`api listening on http://localhost:${port} (env: ${env.NODE_ENV})`);
}

void bootstrap();
