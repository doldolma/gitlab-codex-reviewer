import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  env: {
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? ""
  },
  output: "standalone",
  turbopack: {
    root: projectRoot
  }
};

export default nextConfig;
