import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/agent/coflow-report/SKILL.md",
        headers: [
          { key: "Content-Type", value: "text/markdown; charset=utf-8" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_BASE_URL || "http://127.0.0.1:8080"}/api/:path*`,
      },
    ];
  },
};
export default config;
