import type { NextConfig } from "next";

const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["parking.trai.my", "*.trycloudflare.com"],
  async redirects() {
    // Old flat routes → sectioned apps (keeps installed PWAs working)
    return [
      { source: "/scan", destination: "/officer/scan", permanent: false },
      { source: "/records", destination: "/officer/records", permanent: false },
      { source: "/pay", destination: "/park", permanent: false },
    ];
  },
  async rewrites() {
    return [
      { source: "/api/backend/:path*", destination: `${BACKEND}/:path*` },
      { source: "/photos/:path*", destination: `${BACKEND}/photos/:path*` },
    ];
  },
};

export default nextConfig;
