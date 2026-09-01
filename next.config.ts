import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Home moved from `/Dashboard` to `/` and Apps from `/MyTools` to `/apps`.
   * Bookmarks and pasted links outlive a rename, and `?app=` deep links into Apps
   * are the kind of URL people keep, so the old paths still resolve (queries ride
   * along automatically).
   */
  async redirects() {
    return [
      { source: "/Dashboard", destination: "/", permanent: true },
      { source: "/MyTools", destination: "/apps", permanent: true },
    ];
  },
};

export default nextConfig;
