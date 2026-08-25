import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";
const configDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(configDir, "../..");

const nextConfig: NextConfig = {
  transpilePackages: ["@realm-labs/contracts"],
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  env: {
    FLY_API_APP: process.env.FLY_API_APP ?? "",
  },
  turbopack: {
    root: monorepoRoot,
  },
  async rewrites() {
    return [
      {
        source: "/api/proxy/:path*",
        destination: `${API_ORIGIN}/api/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${API_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
