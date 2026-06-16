import "reflect-metadata";

import { env } from "@10xconnect/config";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: env.APP_URL, credentials: true });
  // All API routes are under /api/v1 (CLAUDE.md §8); /health stays at the root.
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`api listening on http://localhost:${port} (env: ${env.NODE_ENV})`);
}

void bootstrap();
