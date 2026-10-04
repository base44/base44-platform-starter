import type { App } from "../types";
import { Base44Error } from "../base44/error";

export const PAGE_SIZE = 12;

// rows holds one extra row so we know whether another page exists.
// Apps deleted in Base44 (404) are dropped without shifting pagination.
export async function resolveAppPage(
  rows: { appId: string }[],
  skip: number,
  getApp: (id: string) => Promise<App>,
) {
  const page = rows.slice(0, PAGE_SIZE);
  const results = await Promise.all(
    page.map(async (row) => {
      try {
        return await getApp(row.appId);
      } catch (error) {
        if (error instanceof Base44Error && error.status === 404) return null;
        throw error;
      }
    }),
  );
  return {
    apps: results.filter((app): app is App => app !== null),
    hasMore: rows.length > PAGE_SIZE,
    nextSkip: skip + page.length,
  };
}
