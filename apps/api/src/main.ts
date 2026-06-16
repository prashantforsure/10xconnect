import "reflect-metadata";

import { env } from "@10xconnect/config";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`api listening on http://localhost:${port} (env: ${env.NODE_ENV})`);
}

void bootstrap();
