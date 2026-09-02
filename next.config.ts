import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Netlify's build environment knows the deployment's alias origin —
   * `DEPLOY_PRIME_URL`, which is `https://deploy-preview-N--<site>.netlify.app` on a
   * pull request and `https://<branch>--<site>.netlify.app` on a branch deploy — but
   * the server handler's runtime environment does not carry it. Baking it here is
   * what lets src/lib/auth.ts pin the origin rather than trust the request host,
   * which Netlify fills with the deploy permalink instead of the alias. Empty
   * everywhere else, local dev included.
   */
  env: {
    NETLIFY_ALIAS_ORIGIN: process.env.DEPLOY_PRIME_URL ?? "",
  },
};

export default nextConfig;
