import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["wbox.local", "127.0.0.1", "wbox.tail6bacda.ts.net"],
  async rewrites() {
    const backend = process.env.CONVEX_SELF_HOSTED_URL;
    // Local browsers use the app port for HTTP and WebSocket requests, so LAN
    // testing does not require exposing another port through the host firewall.
    if (process.env.NODE_ENV !== "development") return [];
    const storage = process.env.LOCAL_STORAGE_PROXY_TARGET;
    return [
      ...(backend ? [{ source: "/__convex/:path*", destination: `${backend}/:path*` }] : []),
      ...(storage ? [{ source: "/__files/:path*", destination: `${storage}/:path*` }] : []),
    ];
  },
};

export default nextConfig;
