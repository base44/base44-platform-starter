import type { NextConfig } from "next";

// The browser tests mock Tiny's server in the page, so the fixture swaps the
// server actions for fake-actions.ts, which sends each one to a mocked route.
const config: NextConfig = {
  turbopack: {
    resolveAlias: {
      "../server/actions": "./fake-actions.ts",
      "../../server/actions": "./fake-actions.ts",
    },
  },
};

export default config;
