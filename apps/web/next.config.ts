import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import type { NextConfig } from "next";

// Load the single repo-root `.env` (Next only auto-loads from the app dir).
function findNearestEnvFile(startDir: string): string | undefined {
  let dir = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

const envPath = findNearestEnvFile(process.cwd());
if (envPath) {
  loadDotenv({ path: envPath });
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    // Linting is handled by the root ESLint config via `turbo run lint`.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
