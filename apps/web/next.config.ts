import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    // Linting is handled by the root ESLint config via `turbo run lint`.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
