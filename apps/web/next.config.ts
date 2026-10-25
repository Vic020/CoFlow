import type { NextConfig } from "next";
const demo = process.env.NEXT_PUBLIC_COFLOW_PUBLIC_DEMO === "true";
const config: NextConfig = {
  output: demo ? "export" : "standalone",
  ...(demo ? {
    distDir: ".next-pages",
    basePath: process.env.NEXT_PUBLIC_COFLOW_BASE_PATH || "",
    trailingSlash: true,
    images: { unoptimized: true },
  } : {
    async headers() {
      return [{ source: "/:path*", headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
      ] }, { source: "/agent/coflow-report/SKILL.md", headers: [
        { key: "Content-Type", value: "text/markdown; charset=utf-8" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ] }];
    },
    async rewrites() {
      return [{ source: "/api/:path*", destination: `${process.env.API_BASE_URL || "http://127.0.0.1:8080"}/api/:path*` }];
    },
  }),
};
export default config;
