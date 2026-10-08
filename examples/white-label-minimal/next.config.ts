import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Read TINY_SUNNY_LEAN once, at build time, so every page agrees: Netlify passes
  // netlify.toml variables to the build but not to the running server.
  env: { TINY_SUNNY_LEAN: process.env.TINY_SUNNY_LEAN ?? "" },
};

export default nextConfig;
