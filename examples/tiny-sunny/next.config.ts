import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Development's double effects would open every Base44 session twice, and the second
  // waits behind the slow preview call.
  reactStrictMode: false,
};

export default nextConfig;
